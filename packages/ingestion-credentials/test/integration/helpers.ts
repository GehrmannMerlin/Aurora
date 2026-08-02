import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
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

export function credentialsMigrationsDir(): string {
  return fileURLToPath(new URL('../../migrations', import.meta.url));
}

export function inboxMigrationsDir(): string {
  return fileURLToPath(new URL('../../../ingestion-inbox/migrations', import.meta.url));
}

/**
 * Stable combined migrations directory at a fixed repo path (rebuilt each run).
 * node-pg-migrate tracks migrations by filename in `pgmigrations`, so the same
 * filenames at a stable path keep the record consistent across test runs.
 */
const COMBINED_DIR = fileURLToPath(
  new URL('../.migrations-combined', import.meta.url),
);

/** Rebuild the combined migrations directory with inbox + credentials migrations. */
async function ensureCombinedDir(): Promise<string> {
  await rm(COMBINED_DIR, { recursive: true, force: true });
  await mkdir(COMBINED_DIR, { recursive: true });
  for (const source of [inboxMigrationsDir(), credentialsMigrationsDir()]) {
    for (const entry of await readdir(source)) {
      if (entry.endsWith('.ts')) {
        await copyFile(join(source, entry), join(COMBINED_DIR, entry));
      }
    }
  }
  return COMBINED_DIR;
}

/** Apply inbox + credentials migrations from the stable combined directory. */
export async function migrateUp(): Promise<void> {
  const dir = await ensureCombinedDir();
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
  });
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
