import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { assertIsTestDatabase, createTestPool, queryRow, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface ColumnRow {
  column_name: string;
}
interface ConstraintRow {
  conname: string;
}
interface RegClassRow {
  cls: string | null;
}

describeDb('processing-store migrations (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    // Deterministic start: the dedicated test database may hold state from a
    // prior run. Reset the processing-store objects so "fresh up" semantics hold.
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_activities CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_notes CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS issues CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
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
    const rows = await queryRows<{ name: string }>(
      pool,
      'SELECT name FROM pgmigrations ORDER BY id',
    );
    expect(rows.map((row) => row.name)).toContain('1722500000003_error-event-occurrences');
    expect(rows.map((row) => row.name)).toContain('1722500000004_request-event-samples');
    expect(rows.map((row) => row.name)).toContain('1722500000005_request-metric-aggregation');
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

  it('creates error_event_occurrences with expected columns, constraints and unique', async () => {
    const columns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'error_event_occurrences' ORDER BY column_name`,
    );
    const columnNames = columns.map((row) => row.column_name);
    for (const expected of [
      'id',
      'project_id',
      'event_id',
      'protocol_version',
      'occurred_at',
      'error_category',
      'normalized_body',
      'created_at',
    ]) {
      expect(columnNames, `column ${expected}`).toContain(expected);
    }

    const constraints = await queryRows<ConstraintRow>(
      pool,
      `SELECT conname FROM pg_constraint WHERE conrelid = 'error_event_occurrences'::regclass
       ORDER BY conname`,
    );
    const names = constraints.map((row) => row.conname);
    expect(names).toContain('uq_error_event_occurrences_project_event');
    expect(names).toContain('ck_error_event_occurrences_category');
    expect(names).toContain('ck_error_event_occurrences_normalized_body_object');
    expect(names).toContain('ck_error_event_occurrences_category_matches_body');
  });

  it('creates request_event_samples with expected columns, constraints and unique', async () => {
    const columns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'request_event_samples' ORDER BY column_name`,
    );
    const columnNames = columns.map((row) => row.column_name);
    for (const expected of [
      'id',
      'project_id',
      'event_id',
      'protocol_version',
      'occurred_at',
      'sample_body',
      'created_at',
    ]) {
      expect(columnNames, `column ${expected}`).toContain(expected);
    }

    const constraints = await queryRows<ConstraintRow>(
      pool,
      `SELECT conname FROM pg_constraint WHERE conrelid = 'request_event_samples'::regclass
       ORDER BY conname`,
    );
    const names = constraints.map((row) => row.conname);
    expect(names).toContain('uq_request_event_samples_project_event');
    expect(names).toContain('ck_request_event_samples_sample_body_object');
  });

  it('creates request_metric_buckets and request_metric_event_applications with expected constraints', async () => {
    const bucketColumns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'request_metric_buckets' ORDER BY column_name`,
    );
    const bucketColumnNames = bucketColumns.map((row) => row.column_name);
    for (const expected of [
      'id',
      'project_id',
      'bucket_start',
      'method',
      'outcome',
      'status_code',
      'observed_count',
      'failure_count',
      'slow_count',
      'duration_sum_ms',
      'duration_max_ms',
      'created_at',
      'updated_at',
    ]) {
      expect(bucketColumnNames, `bucket column ${expected}`).toContain(expected);
    }
    const bucketConstraints = await queryRows<ConstraintRow>(
      pool,
      `SELECT conname FROM pg_constraint WHERE conrelid = 'request_metric_buckets'::regclass
       ORDER BY conname`,
    );
    const bucketNames = bucketConstraints.map((row) => row.conname);
    expect(bucketNames).toContain('uq_request_metric_buckets_key');
    expect(bucketNames).toContain('ck_request_metric_buckets_status_code');
    expect(bucketNames).toContain('ck_request_metric_buckets_counts');
    expect(bucketNames).toContain('ck_request_metric_buckets_duration');

    const applicationColumns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'request_metric_event_applications' ORDER BY column_name`,
    );
    const applicationColumnNames = applicationColumns.map((row) => row.column_name);
    for (const expected of ['project_id', 'event_id', 'applied_at']) {
      expect(applicationColumnNames, `application column ${expected}`).toContain(expected);
    }
    const applicationConstraints = await queryRows<ConstraintRow>(
      pool,
      `SELECT conname FROM pg_constraint WHERE conrelid = 'request_metric_event_applications'::regclass
       ORDER BY conname`,
    );
    expect(applicationConstraints.map((row) => row.conname)).toContain(
      'pk_request_metric_event_applications',
    );
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
      `SELECT to_regclass('error_event_occurrences') AS cls`,
    );
    expect(before[0]?.cls).toBeNull();
    const beforeRequest = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('request_event_samples') AS cls`,
    );
    expect(beforeRequest[0]?.cls).toBeNull();
    const beforeBucket = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('request_metric_buckets') AS cls`,
    );
    expect(beforeBucket[0]?.cls).toBeNull();
    const beforeApp = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('request_metric_event_applications') AS cls`,
    );
    expect(beforeApp[0]?.cls).toBeNull();

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
      `SELECT to_regclass('error_event_occurrences') AS cls`,
    );
    expect(after[0]?.cls).toBe('error_event_occurrences');
    const afterRequest = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('request_event_samples') AS cls`,
    );
    expect(afterRequest[0]?.cls).toBe('request_event_samples');
    const afterBucket = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('request_metric_buckets') AS cls`,
    );
    expect(afterBucket[0]?.cls).toBe('request_metric_buckets');
    const afterApp = await queryRows<RegClassRow>(
      pool,
      `SELECT to_regclass('request_metric_event_applications') AS cls`,
    );
    expect(afterApp[0]?.cls).toBe('request_metric_event_applications');
  });

  it('creates the performance aggregate and sample tables', async () => {
    const metricBuckets = await queryRow<{ name: string }>(
      pool,
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'performance_metric_buckets'`,
    );
    expect(metricBuckets?.name).toBe('performance_metric_buckets');
    const applications = await queryRow<{ name: string }>(
      pool,
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'performance_metric_event_applications'`,
    );
    expect(applications?.name).toBe('performance_metric_event_applications');
    const samples = await queryRow<{ name: string }>(
      pool,
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'performance_event_samples'`,
    );
    expect(samples?.name).toBe('performance_event_samples');
  });
});
