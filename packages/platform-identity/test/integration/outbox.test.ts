import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimOutboxRows,
  insertOutboxRow,
  markOutboxResult,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface CountRow {
  n: number;
}

/**
 * A claim timestamp safely ahead of any row's `available_at` (which defaults
 * to the PostgreSQL server clock). Guards against client/server clock skew so
 * the claim tests are deterministic.
 */
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

  it('insertOutboxRow persists a row and returns its id', async () => {
    const result = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      aggregateId: crypto.randomUUID(),
      payload: { intentType: 'email_verification', toMasked: 'u***@example.com' },
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const row = await queryRow<{ aggregate_type: string; status: string; attempt_count: number }>(
      pool,
      'SELECT aggregate_type, status, attempt_count FROM outbox WHERE outbox_id = $1',
      [result.outboxId],
    );
    expect(row?.aggregate_type).toBe('email.verification');
    expect(row?.status).toBe('pending');
    expect(row?.attempt_count).toBe(0);
  });

  it('claimOutboxRows claims pending and available rows', async () => {
    await pool.query('DELETE FROM outbox');
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.password_reset',
      payload: { intentType: 'password_reset', toMasked: 'a***@example.com' },
    });
    if (inserted.status !== 'success') throw new Error('expected outbox insert');
    const claimed = await claimOutboxRows(pool, { limit: 10, now: claimNow() });
    expect(claimed.status).toBe('claimed');
    if (claimed.status !== 'claimed') return;
    expect(claimed.rows).toHaveLength(1);
    expect(claimed.rows[0]?.outboxId).toBe(inserted.outboxId);
    expect(claimed.rows[0]?.status).toBe('processing');
    const row = await queryRow<{ status: string }>(
      pool,
      'SELECT status FROM outbox WHERE outbox_id = $1',
      [inserted.outboxId],
    );
    expect(row?.status).toBe('processing');
  });

  it('claimOutboxRows returns nothingToClaim when nothing is pending', async () => {
    await pool.query('DELETE FROM outbox');
    await insertOutboxRow(pool, {
      aggregateType: 'email.invitation',
      payload: { intentType: 'organization_invitation' },
    });
    await pool.query("UPDATE outbox SET status = 'processing'");
    const claimed = await claimOutboxRows(pool, { limit: 10, now: claimNow() });
    expect(claimed).toEqual({ status: 'nothingToClaim' });
  });

  it('claimOutboxRows skips rows whose available_at is in the future', async () => {
    await pool.query('DELETE FROM outbox');
    await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { future: true },
    });
    await pool.query(
      "UPDATE outbox SET available_at = now() + interval '10 minutes'",
    );
    const claimed = await claimOutboxRows(pool, { limit: 10, now: claimNow() });
    expect(claimed).toEqual({ status: 'nothingToClaim' });
  });

  it('does not re-claim an already claimed row', async () => {
    await pool.query('DELETE FROM outbox');
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { once: true },
    });
    if (inserted.status !== 'success') throw new Error('expected outbox insert');
    const first = await claimOutboxRows(pool, { limit: 10, now: claimNow() });
    expect(first.status).toBe('claimed');
    const second = await claimOutboxRows(pool, { limit: 10, now: claimNow() });
    expect(second).toEqual({ status: 'nothingToClaim' });
  });

  it('markOutboxResult settles a claimed row; not_found for unknown id', async () => {
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload: { settle: true },
    });
    if (inserted.status !== 'success') throw new Error('expected outbox insert');
    const settled = await markOutboxResult(pool, {
      outboxId: inserted.outboxId,
      status: 'dead_lettered',
      attemptCount: 5,
    });
    expect(settled).toEqual({ status: 'success' });
    const row = await queryRow<{ status: string; attempt_count: number }>(
      pool,
      'SELECT status, attempt_count FROM outbox WHERE outbox_id = $1',
      [inserted.outboxId],
    );
    expect(row?.status).toBe('dead_lettered');
    expect(row?.attempt_count).toBe(5);
    const missing = await markOutboxResult(pool, {
      outboxId: crypto.randomUUID(),
      status: 'succeeded',
      attemptCount: 1,
    });
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('validate claim limit bounds', async () => {
    await expect(
      claimOutboxRows(pool, { limit: 0, now: new Date() }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      claimOutboxRows(pool, { limit: 101, now: new Date() }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('stores the transient token payload for email link rendering (persisted verbatim)', async () => {
    const payload = {
      intentType: 'email_verification',
      toMasked: 'masked@example.com',
      intentToken: 'short-lived-transient-token',
      expiresInMinutes: 120,
    };
    const inserted = await insertOutboxRow(pool, {
      aggregateType: 'email.verification',
      payload,
    });
    expect(inserted.status).toBe('success');
    const rows = await queryRows<{ payload: unknown }>(
      pool,
      'SELECT payload FROM outbox WHERE outbox_id = $1',
      [inserted.status === 'success' ? inserted.outboxId : ''],
    );
    expect(rows[0]?.payload).toEqual(payload);
    const count = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM outbox WHERE outbox_id = $1',
      [inserted.status === 'success' ? inserted.outboxId : ''],
    );
    expect(count[0]?.n).toBe(1);
  });
});
