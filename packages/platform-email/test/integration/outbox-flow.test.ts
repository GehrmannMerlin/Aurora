import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConsoleEmailAdapter,
  consumeOutboxEmails,
  type OutboxRepository,
  type OutboxStatus,
} from '../../src/index.js';
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
         SET status = 'processing', updated_at = $2
         WHERE outbox_id IN (
           SELECT outbox_id FROM outbox
           WHERE status = 'pending' AND available_at <= $2
           ORDER BY outbox_id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING outbox_id, aggregate_type, aggregate_id, payload, status,
                   attempt_count, available_at, created_at, updated_at`,
        [input.limit, input.now.toISOString()],
      );
      if (result.rows.length === 0) return { status: 'nothingToClaim' };
      return {
        status: 'claimed',
        rows: result.rows.map((r) => ({
          outboxId: r.outbox_id,
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          payload: r.payload,
          status: r.status as OutboxStatus,
          attemptCount: r.attempt_count,
          availableAt: toIso(r.available_at) ?? '',
          createdAt: toIso(r.created_at) ?? '',
          updatedAt: toIso(r.updated_at) ?? '',
        })),
      };
    },

    async markOutboxResult(pool: Pool | PoolClient, input) {
      const result = await pool.query(
        `UPDATE outbox SET status = $2, attempt_count = $3, updated_at = now()
         WHERE outbox_id = $1 RETURNING outbox_id`,
        [input.outboxId, input.status, input.attemptCount],
      );
      return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
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
): Promise<Pick<OutboxRowShape, 'outbox_id' | 'status' | 'attempt_count'>> {
  const result = await pool.query<Pick<OutboxRowShape, 'outbox_id' | 'status' | 'attempt_count'>>(
    'SELECT outbox_id, status, attempt_count FROM outbox WHERE outbox_id = $1',
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

  it('consumes an outbox row to succeeded when the port enqueues', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: emailPayload,
    });

    const port: EmailDeliveryPort = new ConsoleEmailAdapter({
      mode: 'console',
      log: () => undefined,
    });
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
      deliver: () => Promise.resolve({ status: 'failed' as const, reason: 'provider_unavailable' }),
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
  });

  it('dead-letters a malformed payload immediately', async () => {
    const inserted = await outboxRepo.insertOutboxRow(pool, {
      aggregateType: 'email.invitation',
      payload: { broken: true },
    });

    const port: EmailDeliveryPort = {
      deliver: () => Promise.resolve({ status: 'enqueued' as const }),
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
  });
});
