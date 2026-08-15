import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runner, PG_MIGRATE_LOCK_ID } from 'node-pg-migrate';
import { Client, type Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIsTestDatabase, createTestPool, testDatabaseUrl } from './helpers.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const previewRunner = fileURLToPath(
  new URL('../../../../deploy/preview/entry/migrate/run-preview-migrations.js', import.meta.url),
);
const combinedDir = fileURLToPath(
  new URL('../../../../.migrations-combined-preview', import.meta.url),
);
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const LEGACY_PRODUCTION_ORDER = [
  '1722500000000_event-inbox',
  '1722500000001_event-inbox-processing',
  '1722500000002_event-inbox-replay',
  '1722500000002_ingestion-client-credentials',
  '1722500000003_error-event-occurrences',
  '1722500000004_request-event-samples',
  '1722500000005_request-metric-aggregation',
  '1722500000006_performance-aggregate-and-sample',
  '1786233600000_create-platform-identity-tables',
  '1786242000000_organization-settings-version',
  '1786244000000_account-deletion',
  '1786300000000_project-governance',
  '1786500000000_private-tokens',
  '1786700000000_audit-extension',
  '1722500000007_error-occurrence-fingerprint',
  '1722500000008_issue-aggregate-and-samples',
  '1722500000009_issue-activities-notes',
  '1722500000010_alert-rules-and-instances',
  '1722500000011_error-occurrence-symbolizations',
  '1786245000000_account-cleanup-steps',
  '1786700000001_platform-admins',
  '1786700000002_platform-audit-events',
  '1786700000011_platform-resource-policies',
  '1786700000012_organization-policy-overrides',
  '1786700000013_project-policy-limits',
  '1787000000000_releases-and-source-maps',
  '1897000000001_notifications',
] as const;

const EMAIL_MIGRATIONS = [
  '1897000000002_email-verification-resend-and-outbox-reliability',
  '1897000000003_scrub-terminal-email-outbox-payloads',
] as const;

interface ExecFailure extends Error {
  stderr: string;
}

function isExecFailure(error: unknown): error is ExecFailure {
  return (
    error instanceof Error &&
    'stderr' in error &&
    typeof (error as { stderr?: unknown }).stderr === 'string'
  );
}

describeDb('Preview combined migration runner (real PostgreSQL 17)', () => {
  let pool: Pool;
  const schema = `preview_migration_${String(process.pid)}_${randomUUID().replaceAll('-', '')}`;

  const runPreview = () =>
    execFileAsync(process.execPath, [previewRunner], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl(),
        MIGRATIONS_SCHEMA: schema,
      },
      timeout: 120_000,
    });

  const expectPreviewFailure = async (message: string): Promise<void> => {
    try {
      await runPreview();
      throw new Error('expected Preview migration runner to fail');
    } catch (error: unknown) {
      if (!isExecFailure(error)) throw error;
      expect(error.stderr).toContain(message);
    }
  };

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query(`CREATE SCHEMA "${schema}"`);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
    await rm(combinedDir, { recursive: true, force: true });
  });

  it('upgrades the exact production ledger with only the monotonic email migrations', async () => {
    const fresh = await runPreview();
    expect(fresh.stdout).toContain('order=strict');

    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: combinedDir,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      migrationsSchema: schema,
      schema,
      count: 2,
      log: () => undefined,
    });
    await pool.query(`DELETE FROM "${schema}".pgmigrations`);
    await pool.query(
      `INSERT INTO "${schema}".pgmigrations (name, run_on)
       SELECT name, now() + (ordinality * interval '1 millisecond')
       FROM unnest($1::text[]) WITH ORDINALITY AS ledger(name, ordinality)`,
      [LEGACY_PRODUCTION_ORDER],
    );

    const upgraded = await runPreview();
    expect(upgraded.stdout).toContain(
      'preview migrations up: 2 executed; order=approved-production-legacy; pending-before=2',
    );
    const ledger = await pool.query<{ name: string }>(
      `SELECT name FROM "${schema}".pgmigrations ORDER BY id DESC LIMIT 2`,
    );
    expect(ledger.rows.map((row) => row.name).reverse()).toEqual(EMAIL_MIGRATIONS);
  }, 120_000);

  it('rejects concurrent migration execution before reading or changing the ledger', async () => {
    const owner = new Client({ connectionString: testDatabaseUrl() });
    await owner.connect();
    await owner.query('SELECT pg_advisory_lock($1)', [PG_MIGRATE_LOCK_ID]);
    try {
      await expectPreviewFailure('Another migration is already running');
    } finally {
      await owner.query('SELECT pg_advisory_unlock($1)', [PG_MIGRATE_LOCK_ID]);
      await owner.end();
    }
  }, 120_000);

  it('rejects an unknown executed migration without changing the ledger', async () => {
    const unknown = '9999999999999_unknown';
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".pgmigrations (name, run_on)
       VALUES ($1, now()) RETURNING id`,
      [unknown],
    );
    try {
      await expectPreviewFailure(`executed migration is missing from release sources: ${unknown}`);
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${schema}".pgmigrations WHERE name = $1`,
        [unknown],
      );
      expect(count.rows[0]?.count).toBe('1');
    } finally {
      await pool.query(`DELETE FROM "${schema}".pgmigrations WHERE id = $1`, [
        inserted.rows[0]?.id,
      ]);
    }
  }, 120_000);

  it('rejects duplicate and missing production-ledger entries', async () => {
    const duplicate = await pool.query<{ id: number }>(
      `INSERT INTO "${schema}".pgmigrations (name, run_on)
       VALUES ($1, now()) RETURNING id`,
      [LEGACY_PRODUCTION_ORDER[0]],
    );
    try {
      await expectPreviewFailure('migration ledger contains duplicate migration');
    } finally {
      await pool.query(`DELETE FROM "${schema}".pgmigrations WHERE id = $1`, [
        duplicate.rows[0]?.id,
      ]);
    }

    const missing = await pool.query<{ id: number; name: string; run_on: Date }>(
      `DELETE FROM "${schema}".pgmigrations WHERE name = $1 RETURNING id, name, run_on`,
      [LEGACY_PRODUCTION_ORDER[6]],
    );
    try {
      await expectPreviewFailure(
        'migration ledger order is neither globally sorted nor the approved production legacy sequence',
      );
    } finally {
      const row = missing.rows[0];
      await pool.query(
        `INSERT INTO "${schema}".pgmigrations (id, name, run_on) VALUES ($1, $2, $3)`,
        [row?.id, row?.name, row?.run_on],
      );
    }
  }, 120_000);
});
