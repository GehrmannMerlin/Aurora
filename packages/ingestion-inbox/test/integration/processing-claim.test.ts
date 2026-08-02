import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { claimAvailable } from '../../src/processing-claim.js';
import type { ClaimedInboxEvent } from '../../src/processing-types.js';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

interface CountRow {
  n: number;
}

describeDb('ingestion-inbox processing claim (real PostgreSQL 17)', () => {
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

  async function insertPending(eventId: string, projectId = projectA) {
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state)
       VALUES ($1, $2, 'error', 1, '{"protocolVersion":1}'::jsonb,
               now(), now(), now(), now(), 'pending')`,
      [projectId, eventId],
    );
  }

  async function insertRetryWaiting(eventId: string, availableAt: Date) {
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state)
       VALUES ($1, $2, 'error', 1, '{"protocolVersion":1}'::jsonb,
               now(), $3, now(), now(), 'retry_waiting')`,
      [projectA, eventId, availableAt.toISOString()],
    );
  }

  function ids(events: readonly ClaimedInboxEvent[]): Set<string> {
    return new Set(events.map((event) => event.eventId));
  }

  it('claims pending records and increments attempt_count', async () => {
    await insertPending('evt-claim-pending-1');
    await insertPending('evt-claim-pending-2');
    const result = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-1',
    });
    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') return;
    const claimed = result.events;
    expect(claimed.length).toBeGreaterThanOrEqual(1);
    const pending1 = claimed.find((event) => event.eventId === 'evt-claim-pending-1');
    expect(pending1?.attemptCount).toBe(1);
    expect(pending1?.leaseId).toBeTruthy();
    // Cleanup claimed rows.
    await pool.query(`DELETE FROM event_inbox WHERE event_id LIKE 'evt-claim-pending-%'`);
  });

  it('claims only expired retry_waiting, not future ones', async () => {
    await insertRetryWaiting('evt-claim-retry-past', new Date(Date.now() - 60_000));
    await insertRetryWaiting('evt-claim-retry-future', new Date(Date.now() + 60_000));
    const result = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-1',
    });
    expect(result.status).toBe('claimed');
    if (result.status !== 'claimed') return;
    const claimedIds = ids(result.events);
    expect(claimedIds).toContain('evt-claim-retry-past');
    expect(claimedIds).not.toContain('evt-claim-retry-future');
    await pool.query(`DELETE FROM event_inbox WHERE event_id LIKE 'evt-claim-retry-%'`);
  });

  it('does not claim a valid leased record but reclaims an expired one with a new leaseId', async () => {
    await insertPending('evt-claim-lease-active');
    const first = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 60_000,
      workerId: 'worker-a',
    });
    expect(first.status).toBe('claimed');
    const active = first.status === 'claimed' ? first.events[0] : undefined;
    expect(active).toBeDefined();

    // Second worker must not get the active lease; with no other candidates it
    // reports nothingToClaim.
    const second = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 60_000,
      workerId: 'worker-b',
    });
    const secondIds = second.status === 'claimed' ? ids(second.events) : new Set<string>();
    expect(secondIds.has(active?.eventId ?? '')).toBe(false);

    // Expire the lease and confirm a new worker gets a NEW leaseId.
    await pool.query(
      `UPDATE event_inbox SET lease_expires_at = now() - interval '1 second'
       WHERE event_id = $1`,
      [active?.eventId],
    );
    const reclaimed = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 60_000,
      workerId: 'worker-c',
    });
    expect(reclaimed.status).toBe('claimed');
    const reclaimedEvent =
      reclaimed.status === 'claimed'
        ? reclaimed.events.find((event) => event.eventId === active?.eventId)
        : undefined;
    expect(reclaimedEvent).toBeDefined();
    expect(reclaimedEvent?.leaseId).not.toBe(active?.leaseId);
    expect(reclaimedEvent?.attemptCount).toBe(2);
    await pool.query(`DELETE FROM event_inbox WHERE event_id = $1`, [active?.eventId]);
  });

  it('returns non-overlapping claims to two concurrent workers', async () => {
    await pool.query(`DELETE FROM event_inbox`);
    for (let i = 0; i < 20; i += 1) {
      await insertPending(`evt-claim-conc-${String(i).padStart(2, '0')}`);
    }
    const [workerA, workerB] = await Promise.all([
      claimAvailable(pool, { limit: 10, leaseDurationMs: 30_000, workerId: 'worker-a' }),
      claimAvailable(pool, { limit: 10, leaseDurationMs: 30_000, workerId: 'worker-b' }),
    ]);
    const setA = workerA.status === 'claimed' ? ids(workerA.events) : new Set<string>();
    const setB = workerB.status === 'claimed' ? ids(workerB.events) : new Set<string>();
    const overlap = [...setA].filter((eventId) => setB.has(eventId));
    expect(overlap).toHaveLength(0);
    const total = setA.size + setB.size;
    expect(total).toBe(20);
    // Exactly one valid lease per record.
    const leased = await queryRows<{ n: number }>(
      pool,
      `SELECT count(*)::int AS n FROM event_inbox WHERE state='leased'
       AND lease_id IS NOT NULL AND lease_expires_at > now()`,
    );
    expect(leased[0]?.n).toBe(20);
    await pool.query(`DELETE FROM event_inbox`);
  });

  it('leaves no leased state when a claim transaction rolls back', async () => {
    // Simulate a failed claim by opening an explicit transaction, claiming,
    // then rolling back.
    const client = await pool.connect();
    try {
      await insertPending('evt-claim-rollback-1');
      await client.query('BEGIN');
      const result = await claimAvailable(client, {
        limit: 10,
        leaseDurationMs: 30_000,
        workerId: 'worker-x',
      });
      expect(result.status).toBe('claimed');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const rows = await queryRows<CountRow>(
      pool,
      `SELECT count(*)::int AS n FROM event_inbox WHERE event_id='evt-claim-rollback-1' AND state='leased'`,
    );
    expect(rows[0]?.n).toBe(0);
    await pool.query(`DELETE FROM event_inbox WHERE event_id='evt-claim-rollback-1'`);
  });

  it('isolates records across projects', async () => {
    await insertPending('evt-claim-proj-1', projectA);
    await insertPending('evt-claim-proj-1', projectB);
    const result = await claimAvailable(pool, {
      limit: 10,
      leaseDurationMs: 30_000,
      workerId: 'worker-1',
    });
    expect(result.status).toBe('claimed');
    const claimed = result.status === 'claimed' ? result.events : [];
    // Both projects have the same eventId; both are independent rows and both
    // may be claimed, but they must be distinct rows.
    expect(claimed.length).toBe(2);
    const projects = new Set(claimed.map((event) => event.projectId));
    expect(projects.has(projectA)).toBe(true);
    expect(projects.has(projectB)).toBe(true);
    await pool.query(`DELETE FROM event_inbox`);
  });
});
