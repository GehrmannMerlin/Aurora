import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimableWhereClause, expiredLeaseWhereClause } from '../../src/index.js';
import { createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '33333333-3333-3333-3333-333333333333';

interface CountRow {
  n: number;
}
interface IdRow {
  event_id: string;
}

describeDb('ingestion-inbox constraints and state model (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
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

  async function insertRow(eventId: string, overrides: Record<string, unknown> = {}) {
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state, attempt_count)
       VALUES ($1, $2, 'error', 1, '{"protocolVersion":1}'::jsonb, now(), now(), now(), now(), $3, $4)`,
      [
        overrides.project_id ?? projectA,
        eventId,
        overrides.state ?? 'pending',
        overrides.attempt_count ?? 0,
      ],
    );
  }

  it('enforces the (project_id, event_id) unique constraint', async () => {
    await insertRow('evt-constraint-1');
    await expect(insertRow('evt-constraint-1')).rejects.toThrow();
    await pool.query("DELETE FROM event_inbox WHERE event_id = 'evt-constraint-1'");
  });

  it('allows the same eventId under a different project', async () => {
    await insertRow('evt-constraint-2');
    await insertRow('evt-constraint-2', { project_id: projectB });
    const count = await queryRows<CountRow>(
      pool,
      "SELECT count(*)::int AS n FROM event_inbox WHERE event_id = 'evt-constraint-2'",
    );
    expect(count[0]?.n).toBe(2);
    await pool.query("DELETE FROM event_inbox WHERE event_id = 'evt-constraint-2'");
  });

  it('rejects an unknown state value via the check constraint', async () => {
    await expect(insertRow('evt-bad-state', { state: 'bogus' })).rejects.toThrow();
  });

  it('rejects a negative attempt_count', async () => {
    await expect(insertRow('evt-bad-attempt', { attempt_count: -1 })).rejects.toThrow();
  });

  it('never returns processed or dead-lettered records from the claimable predicate', async () => {
    await insertRow('evt-terminal-1', { state: 'processed' });
    await insertRow('evt-terminal-2', { state: 'dead_lettered' });
    const rows = await queryRows<IdRow>(
      pool,
      `SELECT event_id FROM event_inbox WHERE ${claimableWhereClause()}`,
    );
    const ids = rows.map((row) => row.event_id);
    expect(ids).not.toContain('evt-terminal-1');
    expect(ids).not.toContain('evt-terminal-2');
    await pool.query(
      "DELETE FROM event_inbox WHERE event_id IN ('evt-terminal-1','evt-terminal-2')",
    );
  });

  it('does not return retry_waiting records before available_at', async () => {
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state)
       VALUES ($1, 'evt-retry-future', 'error', 1, '{}'::jsonb, now(), now() + interval '1 hour', now(), now(), 'retry_waiting')`,
      [projectA],
    );
    const rows = await queryRows<IdRow>(
      pool,
      `SELECT event_id FROM event_inbox WHERE ${claimableWhereClause()}`,
    );
    const ids = rows.map((row) => row.event_id);
    expect(ids).not.toContain('evt-retry-future');
    await pool.query("DELETE FROM event_inbox WHERE event_id = 'evt-retry-future'");
  });

  it('returns expired leased records from the expired-lease predicate', async () => {
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state, lease_owner, lease_id, lease_expires_at)
       VALUES ($1, 'evt-lease-expired', 'error', 1, '{}'::jsonb, now(), now(), now(), now(),
               'leased', 'worker-1', gen_random_uuid(), now() - interval '1 minute')`,
      [projectA],
    );
    const rows = await queryRows<IdRow>(
      pool,
      `SELECT event_id FROM event_inbox WHERE ${expiredLeaseWhereClause()}`,
    );
    const ids = rows.map((row) => row.event_id);
    expect(ids).toContain('evt-lease-expired');
    await pool.query("DELETE FROM event_inbox WHERE event_id = 'evt-lease-expired'");
  });
});
