import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface ColumnRow {
  column_name: string;
}
interface ConstraintRow {
  conname: string;
}

describeDb('ingestion-inbox processing migrations (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS event_inbox CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies all migrations on an empty schema and records both versions', async () => {
    const executed = await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    expect(executed.length).toBeGreaterThanOrEqual(2);
    const rows = await queryRows<{ name: string }>(
      pool,
      'SELECT name FROM pgmigrations ORDER BY id',
    );
    expect(rows.map((row) => row.name)).toContain('1722500000001_event-inbox-processing');
  });

  it('is idempotent: re-running up executes nothing new', async () => {
    const executed = await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    expect(executed.length).toBe(0);
  });

  it('adds the lease_id column and lease consistency constraint', async () => {
    const columns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name='event_inbox'`,
    );
    expect(columns.map((row) => row.column_name)).toContain('lease_id');

    const constraints = await queryRows<ConstraintRow>(
      pool,
      `SELECT conname FROM pg_constraint WHERE conrelid='event_inbox'::regclass`,
    );
    expect(constraints.map((row) => row.conname)).toContain('ck_event_inbox_lease_consistency');
  });

  it('enforces lease consistency: leased requires lease fields, non-leased forbids them', async () => {
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state)
       VALUES ('11111111-1111-1111-1111-111111111111', 'evt-mig-leased',
               'error', 1, '{}'::jsonb, now(), now(), now(), now(), 'pending')`,
    );
    // pending with a lease_id must be rejected.
    await expect(
      pool.query(
        `UPDATE event_inbox SET lease_id = gen_random_uuid() WHERE event_id = 'evt-mig-leased'`,
      ),
    ).rejects.toThrow();
    // leased without lease fields must be rejected.
    await expect(
      pool.query(`UPDATE event_inbox SET state = 'leased' WHERE event_id = 'evt-mig-leased'`),
    ).rejects.toThrow();
    await pool.query(`DELETE FROM event_inbox WHERE event_id = 'evt-mig-leased'`);
  });

  it('supports down then re-up symmetry', async () => {
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    const columns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name='event_inbox'`,
    );
    expect(columns.map((row) => row.column_name)).not.toContain('lease_id');

    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    const after = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name='event_inbox'`,
    );
    expect(after.map((row) => row.column_name)).toContain('lease_id');
  });
});
