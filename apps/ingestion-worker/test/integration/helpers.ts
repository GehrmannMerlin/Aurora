import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export function testDatabaseUrl(): string {
  const url = process.env.AURORA_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_DATABASE_URL must be set for integration tests');
  }
  return url;
}

/** Verify the target database is the dedicated Aurora test database. */
export function assertIsTestDatabase(url: string): void {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/aurora_inbox_test')) {
    throw new Error(`refusing to connect to non-test database: ${parsed.pathname}`);
  }
}

export function createTestPool(): Pool {
  const url = testDatabaseUrl();
  assertIsTestDatabase(url);
  return new Pool({ connectionString: url });
}

export function migrationsDir(): string {
  return fileURLToPath(new URL('../../../../packages/ingestion-inbox/migrations', import.meta.url));
}

export function processingStoreMigrationsDir(): string {
  return fileURLToPath(
    new URL('../../../../packages/processing-store/migrations', import.meta.url),
  );
}

/**
 * Apply all inbox migrations. The worker shares the ingestion-inbox schema.
 * To make every worker integration test deterministic regardless of prior
 * package suites (which may drop pgmigrations or leave tables unrecorded —
 * OPS-01 cross-package ordering), reset the full test schema first: drop every
 * known table and pgmigrations, then apply the inbox migrations fresh.
 */
export async function migrateUp(): Promise<void> {
  const pool = createTestPool();
  try {
    await pool.query('DROP TABLE IF EXISTS event_inbox_replay_operations CASCADE');
    await pool.query('DROP TABLE IF EXISTS event_inbox CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS issues CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
  } finally {
    await pool.end();
  }
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir(),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    checkOrder: false,
    log: () => undefined,
  });
}

/**
 * Ensure the processing-store error_event_occurrences table exists. The worker
 * test database shares the pgmigrations table with the ingestion-inbox package;
 * checkOrder is disabled because this runner only lists the processing-store
 * migrations and cannot compare against the inbox migrations applied by the
 * shared migrateUp(). migrateUp() has already reset the schema, so applying the
 * 0003 migration fresh records it; applying again is a no-op.
 */
export async function ensureErrorOccurrenceTable(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: processingStoreMigrationsDir(),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    checkOrder: false,
    log: () => undefined,
  });
}

/**
 * Ensure all processing-store tables exist (error_event_occurrences,
 * request_event_samples, request_metric_buckets + request_metric_event_applications,
 * performance_metric_buckets + performance_metric_event_applications +
 * performance_event_samples). Runs every processing-store migration after
 * migrateUp() has reset the schema; already-applied ones are no-ops. Same
 * sharing semantics as ensureErrorOccurrenceTable.
 */
export async function ensureRequestProcessingTables(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: processingStoreMigrationsDir(),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    checkOrder: false,
    log: () => undefined,
  });
}

/** Clear the event_inbox table for a fresh test. */
export async function clearEventInbox(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM event_inbox');
}

/** Run a query and return rows typed as T. */
export async function queryRows<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  sql: string,
  params?: readonly unknown[],
): Promise<T[]> {
  const result: QueryResult<T> = await pool.query<T>(sql, params as unknown[] | undefined);
  return result.rows;
}

/** Run a query and return the first row typed as T | undefined. */
export async function queryRow<T extends QueryResultRow>(
  pool: Pool | PoolClient,
  sql: string,
  params?: readonly unknown[],
): Promise<T | undefined> {
  const rows = await queryRows<T>(pool, sql, params);
  return rows[0];
}
