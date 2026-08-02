import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface MigrationRow {
  name: string;
}
interface ColumnRow {
  column_name: string;
}
interface ConstraintRow {
  conname: string;
}
interface IndexRow {
  indexname: string;
}
interface RegClassRow {
  cls: string | null;
}

describeDb('ingestion-inbox migrations (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    // Deterministic start: the dedicated test database may hold state from a
    // prior run. Reset public-schema objects so "fresh up" semantics hold.
    await pool.query('DROP TABLE IF EXISTS event_inbox CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('runs up on an empty schema and records the version', async () => {
    const executed = await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    expect(executed.length).toBeGreaterThanOrEqual(1);
    const rows = await queryRows<MigrationRow>(
      pool,
      'SELECT name FROM pgmigrations ORDER BY id LIMIT 5',
    );
    expect(rows.map((row) => row.name)).toContain('1722500000000_event-inbox');
  });

  it('is idempotent: re-running up executes no new migrations', async () => {
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

  it('creates event_inbox with expected columns, constraints and indexes', async () => {
    const columns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'event_inbox' ORDER BY column_name`,
    );
    const columnNames = columns.map((row) => row.column_name);
    for (const expected of [
      'id',
      'project_id',
      'event_id',
      'event_type',
      'protocol_version',
      'envelope',
      'request_id',
      'batch_id',
      'batch_index',
      'received_at',
      'state',
      'available_at',
      'lease_owner',
      'lease_expires_at',
      'attempt_count',
      'processed_at',
      'dead_lettered_at',
      'last_error_code',
      'created_at',
      'updated_at',
    ]) {
      expect(columnNames, `column ${expected}`).toContain(expected);
    }

    const constraints = await queryRows<ConstraintRow>(
      pool,
      `SELECT conname FROM pg_constraint WHERE conrelid = 'event_inbox'::regclass
       ORDER BY conname`,
    );
    const names = constraints.map((row) => row.conname);
    expect(names).toContain('uq_event_inbox_project_event');
    expect(names).toContain('ck_event_inbox_state');
    expect(names).toContain('ck_event_inbox_attempt_count');

    const indexes = await queryRows<IndexRow>(
      pool,
      `SELECT indexname FROM pg_indexes WHERE tablename = 'event_inbox' ORDER BY indexname`,
    );
    const indexNames = indexes.map((row) => row.indexname);
    expect(indexNames.join(',')).toContain('event_inbox_state_available_at_index');
    expect(indexNames.join(',')).toContain('event_inbox_received_at_index');
    expect(indexNames.join(',')).toContain('event_inbox_lease_expires_at_index');
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
    const before = await queryRows<RegClassRow>(pool, `SELECT to_regclass('event_inbox') AS cls`);
    expect(before[0]?.cls).toBeNull();

    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    const after = await queryRows<RegClassRow>(pool, `SELECT to_regclass('event_inbox') AS cls`);
    expect(after[0]?.cls).toBe('event_inbox');
  });
});
