import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consumeOutboxEmails, type OutboxRepository, type OutboxStatus } from '../../src/index.js';
import type { EmailDeliveryPort } from '../../src/email-delivery-port.js';
import {
  assertIsTestDatabase,
  createTestPool,
  ensureOutboxTable,
  testDatabaseUrl,
  toIso,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface OutboxRowShape {
  outbox_id: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: unknown;
  status: string;
  attempt_count: number;
  claim_id: string | null;
  last_error_code: string | null;
  provider_request_id: string | null;
  available_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}

/**
 * Inline real-querying outbox repository (workspace `data → {protocol}` means
 * this data-layer package cannot import `@aurora/platform-identity`; the
 * platform-worker composition root will inject the real repo in PLT-03 Task 8).
 */
function createRealOutboxRepo(): OutboxRepository {
  return {
    async insertOutboxRow(pool: Pool | PoolClient, input) {
      const result = await pool.query<{ outbox_id: string }>(
        `INSERT INTO outbox (aggregate_type, aggregate_id, payload)
         VALUES ($1, $2, $3::jsonb)
         RETURNING outbox_id`,
        [input.aggregateType, input.aggregateId ?? null, input.payload],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('outbox insert returned no row');
      return { status: 'success', outboxId: row.outbox_id };
    },

    async claimOutboxRows(pool: Pool | PoolClient, input) {
      const result = await pool.query<OutboxRowShape>(
        `UPDATE outbox
         SET status = 'processing', claim_id = gen_random_uuid(), updated_at = $2
         WHERE outbox_id IN (
           SELECT outbox_id FROM outbox
           WHERE (status IN ('pending', 'failed') AND available_at <= $2)
              OR (status = 'processing'
                  AND updated_at <= $2 - ($3::bigint * interval '1 millisecond'))
           ORDER BY outbox_id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING outbox_id, aggregate_type, aggregate_id, payload, status,
                   attempt_count, claim_id, last_error_code, provider_request_id,
                   available_at, created_at, updated_at`,
        [input.limit, input.now.toISOString(), input.processingTimeoutMs],
      );
      if (result.rows.length === 0) return { status: 'nothingToClaim' };
      return {
        status: 'claimed',
        rows: result.rows.map((r) => {
          if (r.claim_id === null) throw new Error('claimed row missing claim fence');
          return {
            outboxId: r.outbox_id,
            aggregateType: r.aggregate_type,
            aggregateId: r.aggregate_id,
            payload: r.payload,
            status: r.status as OutboxStatus,
            attemptCount: r.attempt_count,
            claimId: r.claim_id,
            lastErrorCode: r.last_error_code,
            providerRequestId: r.provider_request_id,
            availableAt: toIso(r.available_at) ?? '',
            createdAt: toIso(r.created_at) ?? '',
            updatedAt: toIso(r.updated_at) ?? '',
          };
        }),
      };
    },

    async markOutboxResult(pool: Pool | PoolClient, input) {
      const result = await pool.query(
        `UPDATE outbox
         SET status = $3,
             attempt_count = $4,
             available_at = COALESCE($5, available_at),
             last_error_code = $6,
             provider_request_id = $7,
             payload = CASE WHEN $8 THEN '{}'::jsonb ELSE payload END,
             claim_id = NULL,
             updated_at = now()
         WHERE outbox_id = $1 AND status = 'processing' AND claim_id = $2
         RETURNING outbox_id`,
        [
          input.outboxId,
          input.claimId,
          input.status,
          input.attemptCount,
          input.availableAt?.toISOString() ?? null,
          input.errorCode ?? null,
          input.providerRequestId ?? null,
          input.clearPayload,
        ],
      );
      if (result.rows.length > 0) return { status: 'success' };
      const exists = await pool.query('SELECT 1 FROM outbox WHERE outbox_id = $1', [
        input.outboxId,
      ]);
      return exists.rows.length === 0 ? { status: 'not_found' } : { status: 'stale_claim' };
    },
  };
}

/** A claim timestamp safely ahead of any row's `available_at` (client/server clock skew guard). */
function claimNow(): Date {
  return new Date(Date.now() + 60_000);
}

async function selectRow(
  pool: Pool,
  outboxId: string,
): Promise<
  Pick<OutboxRowShape, 'outbox_id' | 'status' | 'attempt_count' | 'available_at'> & {
    payload: unknown;
    claim_id: string | null;
    last_error_code: string | null;
    provider_request_id: string | null;
  }
> {
  const result = await pool.query<
    Pick<OutboxRowShape, 'outbox_id' | 'status' | 'attempt_count' | 'available_at'> & {
      payload: unknown;
      claim_id: string | null;
      last_error_code: string | null;
      provider_request_id: string | null;
    }
  >(
    `SELECT outbox_id, status, attempt_count, available_at, payload,
            claim_id, last_error_code, provider_request_id
     FROM outbox WHERE outbox_id = $1`,
    [outboxId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('outbox row not found');
  return row;
}

const emailPayload = {
  intentType: 'email_verification',
  toAddress: 'user@example.com',
  toMasked: 'u***@example.com',
  mailLinkUrl: 'https://aurora.ah.cn/verify?token=transient-token',
  expiresInMinutes: 120,
  intentExpiresAt: '2099-01-01T00:00:00.000Z',
} as const;

describeDb('platform-email outbox flow (real PostgreSQL 17)', () => {
  let pool: Pool;
  let outboxRepo: OutboxRepository;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await ensureOutboxTable(pool);
    await pool.query('DELETE FROM outbox');
    outboxRepo = createRealOutboxRepo();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('consumes an accepted outbox row, persists provider ID, and scrubs payload', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: emailPayload,
    });

    const port: EmailDeliveryPort = {
      deliver: () =>
        Promise.resolve({ status: 'accepted', providerRequestId: 'provider-request-success' }),
    };
    const result = await consumeOutboxEmails({
      pool,
      port,
      outboxRepo,
      now: claimNow(),
      maxAttempts: 3,
    });

    expect(result).toEqual({ consumed: 1, failed: 0 });
    const row = await selectRow(pool, inserted.outboxId);
    expect(row.status).toBe('succeeded');
    expect(row.attempt_count).toBe(1);
    expect(row.payload).toEqual({});
    expect(row.provider_request_id).toBe('provider-request-success');
  });

  it('dead-letters after the attempt budget is exhausted on a failing port', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.password_reset',
      payload: { ...emailPayload, intentType: 'password_reset' },
    });
    await pool.query('UPDATE outbox SET attempt_count = 2 WHERE outbox_id = $1', [
      inserted.outboxId,
    ]);

    const port: EmailDeliveryPort = {
      deliver: () =>
        Promise.resolve({
          status: 'failed' as const,
          retryable: true,
          reasonCode: 'PROVIDER_UNAVAILABLE',
        }),
    };
    const result = await consumeOutboxEmails({
      pool,
      port,
      outboxRepo,
      now: claimNow(),
      maxAttempts: 3,
    });

    expect(result).toEqual({ consumed: 0, failed: 1 });
    const row = await selectRow(pool, inserted.outboxId);
    expect(row.status).toBe('dead_lettered');
    expect(row.attempt_count).toBe(3);
    expect(row.payload).toEqual({});
    expect(row.last_error_code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('dead-letters a malformed payload immediately', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.invitation',
      payload: { broken: true },
    });

    const port: EmailDeliveryPort = {
      deliver: () => Promise.resolve({ status: 'accepted' as const }),
    };
    const result = await consumeOutboxEmails({
      pool,
      port,
      outboxRepo,
      now: claimNow(),
    });

    expect(result).toEqual({ consumed: 0, failed: 1 });
    const row = await selectRow(pool, inserted.outboxId);
    expect(row.status).toBe('dead_lettered');
    expect(row.attempt_count).toBe(1);
    expect(row.payload).toEqual({});
  });

  it('schedules and later reclaims a retryable failed row', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: emailPayload,
    });
    const firstNow = claimNow();
    const failed = await consumeOutboxEmails({
      pool,
      port: {
        deliver: () =>
          Promise.resolve({
            status: 'failed',
            retryable: true,
            reasonCode: 'EMAIL_PROVIDER_UNAVAILABLE',
          }),
      },
      outboxRepo,
      now: firstNow,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 300_000,
      entropy01: () => 0,
    });
    expect(failed).toEqual({ consumed: 0, failed: 1 });
    const scheduled = await selectRow(pool, inserted.outboxId);
    expect(scheduled.status).toBe('failed');
    expect(new Date(scheduled.available_at).getTime()).toBe(firstNow.getTime() + 500);
    expect(scheduled.payload).toEqual(emailPayload);

    const accepted = await consumeOutboxEmails({
      pool,
      port: { deliver: () => Promise.resolve({ status: 'accepted' }) },
      outboxRepo,
      now: new Date(firstNow.getTime() + 501),
    });
    expect(accepted).toEqual({ consumed: 1, failed: 0 });
    const terminal = await selectRow(pool, inserted.outboxId);
    expect(terminal.status).toBe('succeeded');
    expect(terminal.payload).toEqual({});
  });

  it('recovers stale processing with a new claim fence', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: emailPayload,
    });
    const now = claimNow();
    await pool.query(
      `UPDATE outbox SET status = 'processing', claim_id = $2, updated_at = $3
       WHERE outbox_id = $1`,
      [
        inserted.outboxId,
        '00000000-0000-4000-8000-000000000001',
        new Date(now.getTime() - 301_000),
      ],
    );

    const result = await consumeOutboxEmails({
      pool,
      port: { deliver: () => Promise.resolve({ status: 'accepted' }) },
      outboxRepo,
      now,
      processingTimeoutMs: 300_000,
    });
    expect(result).toEqual({ consumed: 1, failed: 0 });
    expect((await selectRow(pool, inserted.outboxId)).status).toBe('succeeded');
  });

  it('ignores a stale-claim settlement after another worker replaces the fence', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: emailPayload,
    });
    const result = await consumeOutboxEmails({
      pool,
      port: {
        deliver: async () => {
          await pool.query(
            `UPDATE outbox SET claim_id = $2 WHERE outbox_id = $1 AND status = 'processing'`,
            [inserted.outboxId, '00000000-0000-4000-8000-000000000099'],
          );
          return { status: 'accepted', providerRequestId: 'provider-request-stale' };
        },
      },
      outboxRepo,
      now: claimNow(),
    });

    expect(result).toEqual({ consumed: 0, failed: 0 });
    const stale = await selectRow(pool, inserted.outboxId);
    expect(stale.status).toBe('processing');
    expect(stale.payload).toEqual(emailPayload);
    expect(stale.provider_request_id).toBeNull();
  });

  it('scrubs an expired link without calling the provider', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { ...emailPayload, intentExpiresAt: '2020-01-01T00:00:00.000Z' },
    });
    let calls = 0;
    const result = await consumeOutboxEmails({
      pool,
      port: {
        deliver: () => {
          calls += 1;
          return Promise.resolve({ status: 'accepted' });
        },
      },
      outboxRepo,
      now: claimNow(),
    });

    expect(result).toEqual({ consumed: 0, failed: 1 });
    expect(calls).toBe(0);
    const expired = await selectRow(pool, inserted.outboxId);
    expect(expired.status).toBe('dead_lettered');
    expect(expired.payload).toEqual({});
    expect(expired.last_error_code).toBe('EMAIL_INTENT_EXPIRED');
  });
});
