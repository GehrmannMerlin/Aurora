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

/** Apply all inbox migrations. The worker shares the ingestion-inbox schema. */
export async function migrateUp(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir(),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
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
