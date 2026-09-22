import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const PROCESSING_STORE_TABLES_DROP_ORDER = [
  'alert_instance_transitions',
  'alert_instance_evidence',
  'alert_instances',
  'alert_rules',
  'error_occurrence_symbolizations',
  'issue_notes',
  'issue_activities',
  'issue_samples',
  'issue_event_applications',
  'issues',
  'request_metric_event_applications',
  'request_metric_buckets',
  'request_event_samples',
  'error_event_occurrences',
  'performance_metric_event_applications',
  'performance_metric_buckets',
  'performance_event_samples',
  'notifications',
] as const;

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

/** Reset every processing-store object before replaying its full migration set. */
export async function resetProcessingStoreSchema(pool: Pool): Promise<void> {
  for (const table of PROCESSING_STORE_TABLES_DROP_ORDER) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
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
