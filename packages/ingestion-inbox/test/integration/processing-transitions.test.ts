import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { claimAvailable } from '../../src/processing-claim.js';
import {
  markDeadLettered,
  markProcessed,
  renewLease,
  scheduleRetry,
} from '../../src/processing-write-back.js';
import type { ClaimedInboxEvent } from '../../src/processing-types.js';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

interface StateRow {
  state: string;
  lease_id: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  available_at: string | null;
  processed_at: string | null;
  dead_lettered_at: string | null;
}

async function claimOne(pool: Pool, workerId: string): Promise<ClaimedInboxEvent> {
  const result = await claimAvailable(pool, {
    limit: 10,
    leaseDurationMs: 60_000,
    workerId,
  });
  if (result.status !== 'claimed' || result.events.length === 0) {
    throw new Error('expected a claimable record');
  }
  const first = result.events[0];
  if (first === undefined) throw new Error('expected a claimable record');
  return first;
}

async function insertPending(pool: Pool, eventId: string) {
  await pool.query(
    `INSERT INTO event_inbox
       (project_id, event_id, event_type, protocol_version, envelope,
        received_at, available_at, created_at, updated_at, state)
     VALUES ($1, $2, 'error', 1, $3::jsonb,
             now(), now(), now(), now(), 'pending')`,
    [projectA, eventId, JSON.stringify({ protocolVersion: 1, eventId })],
  );
}

async function rowState(pool: Pool, id: number): Promise<StateRow> {
  const rows = await queryRows<StateRow>(
    pool,
    `SELECT state, lease_id, lease_owner, lease_expires_at, attempt_count,
            available_at, processed_at, dead_lettered_at
     FROM event_inbox WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw new Error('row not found');
  const row = rows[0];
  if (row === undefined) throw new Error('row not found');
  return row;
}

describeDb('ingestion-inbox processing fencing and transitions (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    await pool.query('DELETE FROM event_inbox');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects an old lease after a new lease is granted', async () => {
    await insertPending(pool, 'evt-fence-1');
    const first = await claimOne(pool, 'worker-a');
    // Expire and reclaim with a new worker.
    await pool.query(
      `UPDATE event_inbox SET lease_expires_at = now() - interval '1 second' WHERE id = $1`,
      [first.id],
    );
    const second = await claimOne(pool, 'worker-b');
    expect(second.leaseId).not.toBe(first.leaseId);

    // Old lease cannot complete / renew / retry / dead-letter.
    const processed = await markProcessed(pool, { id: first.id, leaseId: first.leaseId });
    expect(processed.status).toBe('lease_lost');
    const renewed = await renewLease(pool, {
      id: first.id,
      leaseId: first.leaseId,
      leaseDurationMs: 30_000,
    });
    expect(renewed.status).toBe('lease_lost');
    const retried = await scheduleRetry(pool, {
      id: first.id,
      leaseId: first.leaseId,
      availableAt: new Date(Date.now() + 60_000),
    });
    expect(retried.status).toBe('lease_lost');
    const dead = await markDeadLettered(pool, { id: first.id, leaseId: first.leaseId });
    expect(dead.status).toBe('lease_lost');
    await pool.query(`DELETE FROM event_inbox WHERE id = $1`, [first.id]);
  });

  it('renews an active lease without incrementing attempt_count', async () => {
    await insertPending(pool, 'evt-fence-renew');
    const claimed = await claimOne(pool, 'worker-a');
    const before = await rowState(pool, claimed.id);
    expect(before.lease_expires_at).not.toBeNull();
    const renewed = await renewLease(pool, {
      id: claimed.id,
      leaseId: claimed.leaseId,
      leaseDurationMs: 120_000,
    });
    expect(renewed.status).toBe('success');
    const after = await rowState(pool, claimed.id);
    expect(after.attempt_count).toBe(before.attempt_count);
    if (before.lease_expires_at === null || after.lease_expires_at === null) {
      throw new Error('expected lease expiry timestamps');
    }
    expect(new Date(after.lease_expires_at).getTime()).toBeGreaterThan(
      new Date(before.lease_expires_at).getTime(),
    );
    await pool.query(`DELETE FROM event_inbox WHERE id = $1`, [claimed.id]);
  });

  it('markProcessed clears lease fields and prevents re-claiming', async () => {
    await insertPending(pool, 'evt-fence-processed');
    const claimed = await claimOne(pool, 'worker-a');
    const result = await markProcessed(pool, { id: claimed.id, leaseId: claimed.leaseId });
    expect(result.status).toBe('success');
    const state = await rowState(pool, claimed.id);
    expect(state.state).toBe('processed');
    expect(state.lease_id).toBeNull();
    expect(state.lease_owner).toBeNull();
    expect(state.processed_at).not.toBeNull();
    // Cannot be claimed again.
    const claim = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-b',
    });
    const ids = claim.status === 'claimed' ? claim.events.map((e) => e.id) : [];
    expect(ids).not.toContain(claimed.id);
    await pool.query(`DELETE FROM event_inbox WHERE id = $1`, [claimed.id]);
  });

  it('scheduleRetry sets retry_waiting with future availableAt and clears lease', async () => {
    await insertPending(pool, 'evt-fence-retry');
    const claimed = await claimOne(pool, 'worker-a');
    const availableAt = new Date(Date.now() + 60_000);
    const result = await scheduleRetry(pool, {
      id: claimed.id,
      leaseId: claimed.leaseId,
      availableAt,
      errorCode: 'rate_limited',
    });
    expect(result.status).toBe('success');
    const state = await rowState(pool, claimed.id);
    expect(state.state).toBe('retry_waiting');
    expect(state.lease_id).toBeNull();
    expect(state.lease_owner).toBeNull();
    expect(state.attempt_count).toBe(1);
    expect(
      state.available_at !== null ? new Date(state.available_at).getTime() : 0,
    ).toBeGreaterThan(Date.now());
    // Not claimable before available_at.
    const claim = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-b',
    });
    const ids = claim.status === 'claimed' ? claim.events.map((e) => e.id) : [];
    expect(ids).not.toContain(claimed.id);
    await pool.query(`DELETE FROM event_inbox WHERE id = $1`, [claimed.id]);
  });

  it('markDeadLettered sets dead_lettered and clears lease', async () => {
    await insertPending(pool, 'evt-fence-dead');
    const claimed = await claimOne(pool, 'worker-a');
    const result = await markDeadLettered(pool, {
      id: claimed.id,
      leaseId: claimed.leaseId,
      errorCode: 'capacity_protected',
    });
    expect(result.status).toBe('success');
    const state = await rowState(pool, claimed.id);
    expect(state.state).toBe('dead_lettered');
    expect(state.lease_id).toBeNull();
    expect(state.dead_lettered_at).not.toBeNull();
    const claim = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-b',
    });
    const ids = claim.status === 'claimed' ? claim.events.map((e) => e.id) : [];
    expect(ids).not.toContain(claimed.id);
    await pool.query(`DELETE FROM event_inbox WHERE id = $1`, [claimed.id]);
  });

  it('keeps the EventEnvelope unchanged after processing transitions', async () => {
    await insertPending(pool, 'evt-fence-env');
    const claimed = await claimOne(pool, 'worker-a');
    const envelopeBefore = JSON.stringify(claimed.event);
    await markProcessed(pool, { id: claimed.id, leaseId: claimed.leaseId });
    const row = await queryRows<{ envelope: unknown }>(
      pool,
      `SELECT envelope FROM event_inbox WHERE id = $1`,
      [claimed.id],
    );
    expect(JSON.stringify(row[0]?.envelope)).toBe(envelopeBefore);
    await pool.query(`DELETE FROM event_inbox WHERE id = $1`, [claimed.id]);
  });
});
