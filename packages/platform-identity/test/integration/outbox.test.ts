import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimOutboxRows,
  getEmailVerificationResendState,
  insertOutboxRow,
  markOutboxResult,
  supersedePendingEmailVerificationOutbox,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
  toIso,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

interface CountRow {
  n: number;
}

function claimNow(): Date {
  return new Date(Date.now() + 60_000);
}

describeDb('platform-identity outbox repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetIdentitySchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('insertOutboxRow persists a pending row and returns its id', async () => {
    const result = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      aggregateId: crypto.randomUUID(),
      payload: { intentType: 'email_verification', toMasked: 'u***@example.invalid' },
    });
    const row = await queryRow<{
      aggregate_type: string;
      status: string;
      attempt_count: number;
      claim_id: string | null;
    }>(
      pool,
      'SELECT aggregate_type, status, attempt_count, claim_id FROM outbox WHERE outbox_id = $1',
      [result.outboxId],
    );
    expect(row).toEqual({
      aggregate_type: 'email.verification',
      status: 'pending',
      attempt_count: 0,
      claim_id: null,
    });
  });

  it('calculates cooldown from initial and resend rows but rolling quota from resend rows only', async () => {
    await pool.query('DELETE FROM outbox');
    const accountId = crypto.randomUUID();
    const now = new Date('2026-08-14T12:00:00.000Z');
    await pool.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, payload, status, created_at, updated_at)
       VALUES
         ('email.verification', $1, '{}'::jsonb, 'succeeded', $2, $2),
         ('email.verification.resend', $1, '{}'::jsonb, 'failed', $3, $3),
         ('email.verification.resend', $1, '{}'::jsonb, 'dead_lettered', $4, $4),
         ('email.invitation', $1, '{}'::jsonb, 'pending', $5, $5)`,
      [
        accountId,
        new Date(now.getTime() - 30_000).toISOString(),
        new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(),
        new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(),
        new Date(now.getTime() - 10_000).toISOString(),
      ],
    );

    await expect(
      getEmailVerificationResendState(pool, {
        accountId,
        now,
        cooldownMs: 60_000,
        rollingWindowMs: 24 * 60 * 60 * 1000,
      }),
    ).resolves.toEqual({
      lastAcceptedAt: new Date(now.getTime() - 30_000).toISOString(),
      resendCount: 1,
    });
  });

  it('supersedes only pending or failed verification rows for the account and scrubs payload', async () => {
    await pool.query('DELETE FROM outbox');
    const accountId = crypto.randomUUID();
    const otherAccountId = crypto.randomUUID();
    const inserted = await pool.query<{ outbox_id: string; marker: string }>(
      `INSERT INTO outbox (aggregate_type, aggregate_id, payload, status)
       VALUES
         ('email.verification', $1, '{"marker":"pending","token":"secret"}'::jsonb, 'pending'),
         ('email.verification.resend', $1, '{"marker":"failed","token":"secret"}'::jsonb, 'failed'),
         ('email.verification', $1, '{"marker":"processing"}'::jsonb, 'processing'),
         ('email.verification', $2, '{"marker":"other"}'::jsonb, 'pending'),
         ('email.password_reset', $1, '{"marker":"password"}'::jsonb, 'pending')
       RETURNING outbox_id, payload->>'marker' AS marker`,
      [accountId, otherAccountId],
    );
    const ids = new Map(inserted.rows.map((row) => [row.marker, row.outbox_id]));
    const now = new Date('2026-08-14T01:00:00.000Z');

    await supersedePendingEmailVerificationOutbox(pool, { accountId, now });

    const rows = await queryRows<{
      outbox_id: string;
      status: string;
      payload: Record<string, unknown>;
      updated_at: string;
    }>(pool, 'SELECT outbox_id, status, payload, updated_at FROM outbox ORDER BY outbox_id');
    const byId = new Map(rows.map((row) => [row.outbox_id, row]));
    for (const marker of ['pending', 'failed']) {
      const row = byId.get(ids.get(marker) ?? '');
      expect(row?.status).toBe('superseded');
      expect(row?.payload).toEqual({});
      expect(toIso(row?.updated_at)).toBe(now.toISOString());
    }
    expect(byId.get(ids.get('processing') ?? '')?.status).toBe('processing');
    expect(byId.get(ids.get('other') ?? '')?.status).toBe('pending');
    expect(byId.get(ids.get('password') ?? '')?.status).toBe('pending');
  });

  it('claims available pending and failed rows with fresh UUID fences', async () => {
    await pool.query('DELETE FROM outbox');
    const now = claimNow();
    const pending = await insertOutboxRow(pool, {
      aggregateType: 'email.password_reset',
      payload: { marker: 'pending' },
    });
    const failed = await insertOutboxRow(pool, {
      aggregateType: 'email.invitation',
      payload: { marker: 'failed' },
    });
    await pool.query("UPDATE outbox SET status = 'failed' WHERE outbox_id = $1", [failed.outboxId]);

    const claimed = await claimOutboxRows(pool, {
      limit: 10,
      now,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 5,
    });
    expect(claimed.status).toBe('claimed');
    if (claimed.status !== 'claimed') return;
    expect(claimed.rows.map((row) => row.outboxId).sort()).toEqual(
      [pending.outboxId, failed.outboxId].sort(),
    );
    for (const row of claimed.rows) {
      expect(row.status).toBe('processing');
      expect(row.attemptCount).toBe(1);
      expect(row.claimId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(new Set(claimed.rows.map((row) => row.claimId)).size).toBe(2);
  });

  it('skips future work and active processing claims', async () => {
    await pool.query('DELETE FROM outbox');
    await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { future: true },
    });
    await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { active: true },
    });
    const now = claimNow();
    await pool.query(`UPDATE outbox SET available_at = $1 WHERE payload ? 'future'`, [
      new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    ]);
    await pool.query(
      `UPDATE outbox SET status = 'processing', updated_at = $1, claim_id = gen_random_uuid()
       WHERE payload ? 'active'`,
      [now.toISOString()],
    );

    await expect(
      claimOutboxRows(pool, {
        limit: 10,
        now,
        processingTimeoutMs: PROCESSING_TIMEOUT_MS,
        maxAttempts: 5,
      }),
    ).resolves.toEqual({ status: 'nothingToClaim' });
  });

  it('reclaims stale processing rows with a new claim UUID', async () => {
    await pool.query('DELETE FROM outbox');
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { reclaim: true },
    });
    const firstNow = claimNow();
    const first = await claimOutboxRows(pool, {
      limit: 1,
      now: firstNow,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 5,
    });
    if (first.status !== 'claimed') throw new Error('expected first claim');
    const firstClaimId = first.rows[0]?.claimId;

    const second = await claimOutboxRows(pool, {
      limit: 1,
      now: new Date(firstNow.getTime() + PROCESSING_TIMEOUT_MS + 1),
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 5,
    });
    if (second.status !== 'claimed') throw new Error('expected stale reclaim');
    expect(second.rows[0]?.outboxId).toBe(inserted.outboxId);
    expect(second.rows[0]?.claimId).not.toBe(firstClaimId);
    expect(second.rows[0]?.attemptCount).toBe(2);
  });

  it('durably consumes the attempt budget on claim and scrubs a crashed final attempt', async () => {
    await pool.query('DELETE FROM outbox');
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { token: 'transient' },
    });
    const firstNow = claimNow();
    const first = await claimOutboxRows(pool, {
      limit: 1,
      now: firstNow,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 2,
    });
    if (first.status !== 'claimed' || first.rows[0] === undefined)
      throw new Error('expected claim');
    expect(first.rows[0].attemptCount).toBe(1);

    const secondNow = new Date(firstNow.getTime() + PROCESSING_TIMEOUT_MS + 1);
    const second = await claimOutboxRows(pool, {
      limit: 1,
      now: secondNow,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 2,
    });
    if (second.status !== 'claimed' || second.rows[0] === undefined) {
      throw new Error('expected final claim');
    }
    expect(second.rows[0].attemptCount).toBe(2);

    await expect(
      claimOutboxRows(pool, {
        limit: 1,
        now: new Date(secondNow.getTime() + PROCESSING_TIMEOUT_MS + 1),
        processingTimeoutMs: PROCESSING_TIMEOUT_MS,
        maxAttempts: 2,
      }),
    ).resolves.toEqual({ status: 'nothingToClaim' });
    const terminal = await queryRow<{
      status: string;
      attempt_count: number;
      payload: unknown;
      claim_id: string | null;
      last_error_code: string | null;
    }>(
      pool,
      `SELECT status, attempt_count, payload, claim_id, last_error_code
       FROM outbox WHERE outbox_id = $1`,
      [inserted.outboxId],
    );
    expect(terminal).toEqual({
      status: 'dead_lettered',
      attempt_count: 2,
      payload: {},
      claim_id: null,
      last_error_code: 'EMAIL_ATTEMPTS_EXHAUSTED',
    });
  });

  it('settles only the current claim, supports retry timing, and clears claim metadata', async () => {
    await pool.query('DELETE FROM outbox');
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { token: 'transient' },
    });
    const now = claimNow();
    const claimed = await claimOutboxRows(pool, {
      limit: 1,
      now,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 5,
    });
    if (claimed.status !== 'claimed' || claimed.rows[0] === undefined) {
      throw new Error('expected claim');
    }
    const retryAt = new Date(now.getTime() + 30_000);
    await expect(
      markOutboxResult(pool, {
        outboxId: inserted.outboxId,
        claimId: claimed.rows[0].claimId,
        status: 'failed',
        attemptCount: 1,
        availableAt: retryAt,
        errorCode: 'provider_throttled',
        clearPayload: false,
      }),
    ).resolves.toEqual({ status: 'success' });
    const row = await queryRow<{
      status: string;
      attempt_count: number;
      available_at: string;
      last_error_code: string | null;
      claim_id: string | null;
      payload: unknown;
    }>(
      pool,
      `SELECT status, attempt_count, available_at, last_error_code, claim_id, payload
       FROM outbox WHERE outbox_id = $1`,
      [inserted.outboxId],
    );
    expect(row?.status).toBe('failed');
    expect(row?.attempt_count).toBe(1);
    expect(toIso(row?.available_at)).toBe(retryAt.toISOString());
    expect(row?.last_error_code).toBe('provider_throttled');
    expect(row?.claim_id).toBeNull();
    expect(row?.payload).toEqual({ token: 'transient' });
  });

  it.each(['succeeded', 'dead_lettered'] as const)(
    'scrubs payload when settling terminal status %s',
    async (status) => {
      await pool.query('DELETE FROM outbox');
      const inserted = await insertOutboxRow(pool, {
        aggregateType: 'email.verification',
        payload: { token: 'transient' },
      });
      const claimed = await claimOutboxRows(pool, {
        limit: 1,
        now: claimNow(),
        processingTimeoutMs: PROCESSING_TIMEOUT_MS,
        maxAttempts: 5,
      });
      if (claimed.status !== 'claimed' || claimed.rows[0] === undefined) {
        throw new Error('expected claim');
      }
      await expect(
        markOutboxResult(pool, {
          outboxId: inserted.outboxId,
          claimId: claimed.rows[0].claimId,
          status,
          attemptCount: 1,
          providerRequestId: 'provider-request-redacted',
          clearPayload: true,
        }),
      ).resolves.toEqual({ status: 'success' });
      const row = await queryRow<{
        status: string;
        payload: unknown;
        claim_id: string | null;
        provider_request_id: string | null;
      }>(
        pool,
        'SELECT status, payload, claim_id, provider_request_id FROM outbox WHERE outbox_id = $1',
        [inserted.outboxId],
      );
      expect(row).toEqual({
        status,
        payload: {},
        claim_id: null,
        provider_request_id: 'provider-request-redacted',
      });
    },
  );

  it('rejects stale settlement after timeout recovery and preserves the newer claim', async () => {
    await pool.query('DELETE FROM outbox');
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { token: 'transient' },
    });
    const firstNow = claimNow();
    const first = await claimOutboxRows(pool, {
      limit: 1,
      now: firstNow,
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 5,
    });
    if (first.status !== 'claimed' || first.rows[0] === undefined)
      throw new Error('expected claim');
    const second = await claimOutboxRows(pool, {
      limit: 1,
      now: new Date(firstNow.getTime() + PROCESSING_TIMEOUT_MS + 1),
      processingTimeoutMs: PROCESSING_TIMEOUT_MS,
      maxAttempts: 5,
    });
    if (second.status !== 'claimed' || second.rows[0] === undefined) {
      throw new Error('expected reclaim');
    }

    await expect(
      markOutboxResult(pool, {
        outboxId: inserted.outboxId,
        claimId: first.rows[0].claimId,
        status: 'succeeded',
        attemptCount: 1,
        clearPayload: true,
      }),
    ).resolves.toEqual({ status: 'stale_claim' });
    const current = await queryRow<{ status: string; claim_id: string; payload: unknown }>(
      pool,
      'SELECT status, claim_id, payload FROM outbox WHERE outbox_id = $1',
      [inserted.outboxId],
    );
    expect(current?.status).toBe('processing');
    expect(current?.claim_id).toBe(second.rows[0].claimId);
    expect(current?.payload).toEqual({ token: 'transient' });

    await expect(
      markOutboxResult(pool, {
        outboxId: crypto.randomUUID(),
        claimId: crypto.randomUUID(),
        status: 'dead_lettered',
        attemptCount: 5,
        clearPayload: true,
      }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('validates claim bounds and processing timeout', async () => {
    await expect(
      claimOutboxRows(pool, {
        limit: 0,
        now: new Date(),
        processingTimeoutMs: 1,
        maxAttempts: 5,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      claimOutboxRows(pool, {
        limit: 101,
        now: new Date(),
        processingTimeoutMs: 1,
        maxAttempts: 5,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      claimOutboxRows(pool, {
        limit: 1,
        now: new Date(),
        processingTimeoutMs: 0,
        maxAttempts: 5,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      claimOutboxRows(pool, {
        limit: 1,
        now: new Date(),
        processingTimeoutMs: 1,
        maxAttempts: 0,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('stores a transient link payload verbatim until terminal cleanup', async () => {
    const payload = {
      intentType: 'email_verification',
      toMasked: 'masked@example.invalid',
      intentToken: 'short-lived-transient-token',
      expiresInMinutes: 120,
    };
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload,
    });
    const rows = await queryRows<{ payload: unknown }>(
      pool,
      'SELECT payload FROM outbox WHERE outbox_id = $1',
      [inserted.outboxId],
    );
    expect(rows[0]?.payload).toEqual(payload);
    const count = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM outbox WHERE outbox_id = $1',
      [inserted.outboxId],
    );
    expect(count[0]?.n).toBe(1);
  });
});
