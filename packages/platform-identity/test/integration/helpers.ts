import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

/** The platform-identity tables, in FK-safe drop order. */
const IDENTITY_TABLES_DROP_ORDER = [
  'account_cleanup_steps',
  'outbox',
  'idempotency_records',
  'security_audit_events',
  'project_members',
  'organization_invitations',
  'organization_members',
  'organizations',
  'account_cleanup_handoffs',
  'account_deletion_intents',
  'password_reset_intents',
  'email_verification_intents',
  'account_credentials',
  'accounts',
];

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

/** Drop the platform-identity tables (children first) + pgmigrations for a fresh-up. */
export async function resetIdentitySchema(pool: Pool): Promise<void> {
  for (const table of IDENTITY_TABLES_DROP_ORDER) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
}

/** Run all platform-identity migrations up (idempotent). */
export async function runMigrationsUp(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
  });
}

/**
 * Normalize a raw pg timestamptz value (a JS Date at runtime) to a stable
 * ISO-8601 UTC string for equality assertions.
 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
