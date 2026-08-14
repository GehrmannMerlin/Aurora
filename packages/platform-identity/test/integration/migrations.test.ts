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
interface TableRow {
  tablename: string;
}
interface RegClassRow {
  cls: string | null;
}

const IDENTITY_TABLES = [
  'accounts',
  'account_credentials',
  'email_verification_intents',
  'password_reset_intents',
  'organizations',
  'organization_members',
  'organization_invitations',
  'project_members',
  'security_audit_events',
  'idempotency_records',
  'outbox',
  'account_deletion_intents',
  'account_cleanup_handoffs',
  'account_cleanup_steps',
];

describeDb('platform-identity migrations (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    // Deterministic start: the dedicated test database may hold state from a
    // prior run. Drop identity tables (children first) + pgmigrations so
    // "fresh up" semantics hold.
    await pool.query('DROP TABLE IF EXISTS account_cleanup_steps CASCADE');
    await pool.query('DROP TABLE IF EXISTS outbox CASCADE');
    await pool.query('DROP TABLE IF EXISTS idempotency_records CASCADE');
    await pool.query('DROP TABLE IF EXISTS security_audit_events CASCADE');
    await pool.query('DROP TABLE IF EXISTS project_members CASCADE');
    await pool.query('DROP TABLE IF EXISTS organization_invitations CASCADE');
    await pool.query('DROP TABLE IF EXISTS organization_members CASCADE');
    await pool.query('DROP TABLE IF EXISTS organizations CASCADE');
    await pool.query('DROP TABLE IF EXISTS account_cleanup_handoffs CASCADE');
    await pool.query('DROP TABLE IF EXISTS account_deletion_intents CASCADE');
    await pool.query('DROP TABLE IF EXISTS password_reset_intents CASCADE');
    await pool.query('DROP TABLE IF EXISTS email_verification_intents CASCADE');
    await pool.query('DROP TABLE IF EXISTS account_credentials CASCADE');
    await pool.query('DROP TABLE IF EXISTS accounts CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('runs up on an empty schema and records the migration', async () => {
    const executed = await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    expect(executed.length).toBeGreaterThanOrEqual(1);
    const rows = await queryRows<MigrationRow>(pool, 'SELECT name FROM pgmigrations ORDER BY id');
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        '1786233600000_create-platform-identity-tables',
        '1786244000000_account-deletion',
        '1786665600000_email-verification-resend-and-outbox-reliability',
      ]),
    );
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

  it('creates all identity tables', async () => {
    const tables = await queryRows<TableRow>(
      pool,
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('accounts','account_credentials','email_verification_intents','password_reset_intents','organizations','organization_members','organization_invitations','project_members','security_audit_events','idempotency_records','outbox','account_deletion_intents','account_cleanup_handoffs','account_cleanup_steps')",
    );
    const tableNames = tables.map((row) => row.tablename).sort();
    expect(tableNames).toEqual([...IDENTITY_TABLES].sort());
  });

  it('adds the A5 deletion timeline columns to accounts', async () => {
    const columns = await queryRows<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'accounts'
         AND column_name IN ('deletion_requested_at','deletion_cooling_ends_at','deletion_terminated_at')
       ORDER BY column_name`,
    );
    expect(columns.map((row) => row.column_name)).toEqual([
      'deletion_cooling_ends_at',
      'deletion_requested_at',
      'deletion_terminated_at',
    ]);
  });

  it('adds fenced outbox delivery columns, indexes, and the superseded state', async () => {
    const columns = await queryRows<{ column_name: string; data_type: string }>(
      pool,
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'outbox'
         AND column_name IN ('claim_id','last_error_code','provider_request_id')
       ORDER BY column_name`,
    );
    expect(columns).toEqual([
      { column_name: 'claim_id', data_type: 'uuid' },
      { column_name: 'last_error_code', data_type: 'text' },
      { column_name: 'provider_request_id', data_type: 'text' },
    ]);

    const indexes = await queryRows<{ indexname: string }>(
      pool,
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'outbox'
         AND indexname IN ('outbox_claimable_idx','outbox_email_resend_window_idx')
       ORDER BY indexname`,
    );
    expect(indexes.map((row) => row.indexname)).toEqual([
      'outbox_claimable_idx',
      'outbox_email_resend_window_idx',
    ]);

    await expect(
      pool.query(
        `INSERT INTO outbox (aggregate_type, payload, status)
         VALUES ('email.verification', '{}'::jsonb, 'superseded')`,
      ),
    ).resolves.toBeDefined();
    await pool.query("DELETE FROM outbox WHERE status = 'superseded'");
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
    const before = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('public.accounts') AS cls`,
    );
    expect(before[0]?.cls).toBeNull();

    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    const after = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('public.accounts') AS cls`,
    );
    expect(after[0]?.cls).toBe('accounts');
  });
});
