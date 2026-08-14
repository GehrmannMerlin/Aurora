import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsoleEmailAdapter, type EmailDeliveryPort } from '@aurora/platform-email';
import { buildPlatformWorker } from '../../src/worker.js';
import { createPlatformOutboxRepository } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  ensureOutboxTable,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface OutboxRowShape {
  outbox_id: string;
  aggregate_type: string;
  status: string;
  attempt_count: number;
  payload: Record<string, unknown>;
  last_error_code: string | null;
  provider_request_id: string | null;
  available_at: Date;
}

function emailPayload(intentType = 'email_verification'): Record<string, unknown> {
  return {
    intentType,
    toAddress: 'recipient@tests.invalid',
    toMasked: 'r***@tests.invalid',
    mailLinkUrl: 'https://console.invalid/verify-email?token=not-a-real-token',
    expiresInMinutes: 120,
    intentExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

const workerSettings = {
  pollIntervalMs: 20,
  batchLimit: 20,
  maxAttempts: 3,
  processingTimeoutMs: 100,
  retryBaseDelayMs: 10,
  retryMaxDelayMs: 30,
} as const;

async function insertRow(pool: Pool, payload: unknown, aggregateType: string): Promise<string> {
  const result = await pool.query<{ outbox_id: string }>(
    'INSERT INTO outbox (aggregate_type, payload) VALUES ($1, $2::jsonb) RETURNING outbox_id',
    [aggregateType, payload],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('outbox insert returned no row');
  return row.outbox_id;
}

async function selectRow(pool: Pool, outboxId: string): Promise<OutboxRowShape> {
  const result = await pool.query<OutboxRowShape>(
    `SELECT outbox_id, aggregate_type, status, attempt_count, payload,
            last_error_code, provider_request_id, available_at
       FROM outbox WHERE outbox_id = $1`,
    [outboxId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('outbox row not found');
  return row;
}

async function waitForStatus(
  pool: Pool,
  outboxId: string,
  status: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await selectRow(pool, outboxId);
    if (row.status === status) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for outbox ${outboxId} to reach ${status}; current=${row.status}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describeDb('apps/platform-worker outbox consumer (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await ensureOutboxTable(pool);
    await pool.query('DELETE FROM outbox');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('claims and settles outbox rows to succeeded via the console adapter', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const id = await insertRow(pool, emailPayload(), 'email.verification');

    const worker = buildPlatformWorker({
      pool,
      port: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      outboxRepo,
      ...workerSettings,
    });

    await worker.start();
    try {
      await waitForStatus(pool, id, 'succeeded');
    } finally {
      await worker.stop();
    }

    const row = await selectRow(pool, id);
    expect(row.status).toBe('succeeded');
    expect(row.attempt_count).toBe(1);
    expect(row.payload).toEqual({});
  });

  it('schedules a retry and later succeeds through an injected fake port', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const id = await insertRow(pool, emailPayload('password_reset'), 'email.password_reset');
    const firstAttemptStartedAt = new Date();
    let deliveries = 0;
    const retryThenAcceptPort: EmailDeliveryPort = {
      deliver: () => {
        deliveries += 1;
        return Promise.resolve(
          deliveries === 1
            ? { status: 'failed', retryable: true, reasonCode: 'EMAIL_PROVIDER_TIMEOUT' }
            : { status: 'accepted', providerRequestId: 'provider-request-2' },
        );
      },
    };

    const worker = buildPlatformWorker({
      pool,
      port: retryThenAcceptPort,
      outboxRepo,
      ...workerSettings,
      retryBaseDelayMs: 10_000,
      retryMaxDelayMs: 10_000,
    });

    await worker.start();
    try {
      await waitForStatus(pool, id, 'failed');
    } finally {
      await worker.stop();
    }

    const retryScheduled = await selectRow(pool, id);
    expect(retryScheduled.attempt_count).toBe(1);
    expect(retryScheduled.last_error_code).toBe('EMAIL_PROVIDER_TIMEOUT');
    expect(retryScheduled.available_at.getTime()).toBeGreaterThan(firstAttemptStartedAt.getTime());
    expect(retryScheduled.payload).not.toEqual({});

    await pool.query('UPDATE outbox SET available_at = now() WHERE outbox_id = $1', [id]);
    const recoveryWorker = buildPlatformWorker({
      pool,
      port: retryThenAcceptPort,
      outboxRepo,
      ...workerSettings,
    });
    await recoveryWorker.start();
    try {
      await waitForStatus(pool, id, 'succeeded');
    } finally {
      await recoveryWorker.stop();
    }

    const row = await selectRow(pool, id);
    expect(deliveries).toBe(2);
    expect(row.attempt_count).toBe(2);
    expect(row.provider_request_id).toBe('provider-request-2');
    expect(row.payload).toEqual({});
  });

  it('dead-letters at the attempt budget and scrubs terminal payloads', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const id = await insertRow(pool, emailPayload('password_reset'), 'email.password_reset');
    await pool.query('UPDATE outbox SET attempt_count = 2 WHERE outbox_id = $1', [id]);

    const failingPort: EmailDeliveryPort = {
      deliver: () =>
        Promise.resolve({
          status: 'failed',
          retryable: true,
          reasonCode: 'EMAIL_PROVIDER_UNAVAILABLE',
        }),
    };

    const worker = buildPlatformWorker({
      pool,
      port: failingPort,
      outboxRepo,
      ...workerSettings,
    });

    await worker.start();
    try {
      await waitForStatus(pool, id, 'dead_lettered');
    } finally {
      await worker.stop();
    }

    const row = await selectRow(pool, id);
    expect(row.status).toBe('dead_lettered');
    expect(row.attempt_count).toBe(3);
    expect(row.last_error_code).toBe('EMAIL_PROVIDER_UNAVAILABLE');
    expect(row.payload).toEqual({});
  });

  it('recovers a stale processing claim and fences it with a fresh claim', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const id = await insertRow(pool, emailPayload('password_reset'), 'email.password_reset');
    await pool.query(
      `UPDATE outbox
          SET status = 'processing', claim_id = gen_random_uuid(),
              updated_at = now() - interval '10 minutes'
        WHERE outbox_id = $1`,
      [id],
    );
    const acceptedPort: EmailDeliveryPort = {
      deliver: () =>
        Promise.resolve({ status: 'accepted', providerRequestId: 'provider-recovered' }),
    };

    const worker = buildPlatformWorker({
      pool,
      port: acceptedPort,
      outboxRepo,
      ...workerSettings,
    });

    await worker.start();
    try {
      await waitForStatus(pool, id, 'succeeded');
    } finally {
      await worker.stop();
    }

    const row = await selectRow(pool, id);
    expect(row.attempt_count).toBe(1);
    expect(row.provider_request_id).toBe('provider-recovered');
    expect(row.payload).toEqual({});
  });

  it('stops the poll loop promptly on stop()', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const worker = buildPlatformWorker({
      pool,
      port: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      outboxRepo,
      ...workerSettings,
      pollIntervalMs: 60_000,
    });

    await worker.start();
    const startedAt = Date.now();
    await worker.stop();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(worker.status).toBe('stopped');
  });
});
