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
}

const emailPayload = {
  intentType: 'email_verification',
  toAddress: 'user@example.com',
  toMasked: 'u***@example.com',
  mailLinkUrl: 'https://aurora.ah.cn/verify?token=transient-token',
  expiresInMinutes: 120,
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
    'SELECT outbox_id, aggregate_type, status, attempt_count FROM outbox WHERE outbox_id = $1',
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
      throw new Error(`timed out waiting for outbox ${outboxId} to reach ${status}; current=${row.status}`);
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
    const id = await insertRow(pool, emailPayload, 'email.verification');

    const worker = buildPlatformWorker({
      pool,
      port: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      outboxRepo,
      pollIntervalMs: 20,
      batchLimit: 20,
      maxAttempts: 5,
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
  });

  it('dead-letters a row after the attempt budget is exhausted on a failing port', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const id = await insertRow(
      pool,
      { ...emailPayload, intentType: 'password_reset' },
      'email.password_reset',
    );
    await pool.query('UPDATE outbox SET attempt_count = 2 WHERE outbox_id = $1', [id]);

    const failingPort: EmailDeliveryPort = {
      deliver: async () => ({ status: 'failed' as const, reason: 'provider_unavailable' }),
    };

    const worker = buildPlatformWorker({
      pool,
      port: failingPort,
      outboxRepo,
      pollIntervalMs: 20,
      batchLimit: 20,
      maxAttempts: 3,
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
  });

  it('stops the poll loop promptly on stop()', async () => {
    const outboxRepo = createPlatformOutboxRepository();
    const worker = buildPlatformWorker({
      pool,
      port: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      outboxRepo,
      pollIntervalMs: 60_000,
      batchLimit: 20,
      maxAttempts: 5,
    });

    await worker.start();
    const startedAt = Date.now();
    await worker.stop();
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(worker.status).toBe('stopped');
  });
});
