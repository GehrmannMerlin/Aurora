import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * The platform-organization integration tests need the PLT-03 tables
 * (organizations, organization_members, organization_invitations,
 * security_audit_events, accounts). This package may not depend on
 * `@aurora/platform-identity` (data → {protocol} only), so the test helper runs
 * the platform-identity migration directory via node-pg-migrate's runner. This
 * is test-only cross-directory migration execution, not a package dependency.
 */
const identityMigrationsDir = fileURLToPath(
  new URL('../../../platform-identity/migrations', import.meta.url),
);

const organizationMigrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

/** The PLT-03 tables, in FK-safe drop order. */
const IDENTITY_TABLES_DROP_ORDER = [
  'outbox',
  'idempotency_records',
  'security_audit_events',
  'project_members',
  'organization_invitations',
  'organization_members',
  'organizations',
  'password_reset_intents',
  'email_verification_intents',
  'account_credentials',
  // SEC-01 A5 account-deletion tables (created by the shared identity migration
  // directory; FK → accounts, so they must be dropped before accounts so
  // re-running migrations stays fresh).
  'account_cleanup_handoffs',
  'account_deletion_intents',
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

/** Drop the PLT-03 tables (children first) + pgmigrations for a fresh-up. */
export async function resetOrganizationSchema(pool: Pool): Promise<void> {
  for (const table of IDENTITY_TABLES_DROP_ORDER) {
    await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
  await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
}

/**
 * Run the platform-identity migrations (PLT-03 tables) first, then the
 * platform-organization migrations (settings version + index), in order.
 *
 * `checkOrder: false` on both runner calls: each call targets the same shared
 * `pgmigrations` table but a different directory, so the runner's cross-directory
 * ordering assertion would otherwise reject the second set as "preceding" an
 * already-applied migration. The schema is always reset first, making the
 * combined application order deterministic (identity, then organization).
 */
export async function runMigrationsUp(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: identityMigrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
    checkOrder: false,
  });
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: organizationMigrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
    checkOrder: false,
  });
}

/**
 * Run only the platform-organization migration down (`count: 1` = this
 * package's single migration). `checkOrder: false` for the same shared
 * `pgmigrations`-table reason as `runMigrationsUp`. `count: Infinity` would
 * trigger node-pg-migrate's "definitions deleted" validation because the PLT-03
 * identity migration shares the table from a sibling directory.
 */
export async function runOrganizationMigrationsDown(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: organizationMigrationsDir,
    direction: 'down',
    migrationsTable: 'pgmigrations',
    count: 1,
    log: () => undefined,
    checkOrder: false,
  });
}

/** Insert an active account and return its id. */
export async function createTestAccount(pool: Pool, email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const result = await pool.query<{ account_id: string }>(
    `INSERT INTO accounts (email, email_normalized, status)
     VALUES ($1, $1, 'active')
     RETURNING account_id`,
    [normalized],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('account insert returned no row');
  return row.account_id;
}

/** Create an organization owned by `ownerAccountId` and return its id. */
export async function createTestOrganization(
  pool: Pool,
  name: string,
  ownerAccountId: string,
): Promise<string> {
  const org = await pool.query<{ organization_id: string }>(
    `INSERT INTO organizations (name, kind) VALUES ($1, 'organization') RETURNING organization_id`,
    [name],
  );
  const orgId = org.rows[0]?.organization_id;
  if (orgId === undefined) throw new Error('org insert returned no row');
  await pool.query(
    `INSERT INTO organization_members (organization_id, account_id, role) VALUES ($1, $2, 'owner')`,
    [orgId, ownerAccountId],
  );
  return orgId;
}

/** Create a personal workspace organization owned by `ownerAccountId` and return its id. */
export async function createTestPersonalOrganization(
  pool: Pool,
  name: string,
  ownerAccountId: string,
): Promise<string> {
  const org = await pool.query<{ organization_id: string }>(
    `INSERT INTO organizations (name, kind) VALUES ($1, 'personal') RETURNING organization_id`,
    [name],
  );
  const orgId = org.rows[0]?.organization_id;
  if (orgId === undefined) throw new Error('org insert returned no row');
  await pool.query(
    `INSERT INTO organization_members (organization_id, account_id, role) VALUES ($1, $2, 'owner')`,
    [orgId, ownerAccountId],
  );
  return orgId;
}

/** Add a non-owner organization member. */
export async function addTestMember(
  pool: Pool,
  orgId: string,
  accountId: string,
  role: 'admin' | 'member',
): Promise<void> {
  await pool.query(
    `INSERT INTO organization_members (organization_id, account_id, role) VALUES ($1, $2, $3)`,
    [orgId, accountId, role],
  );
}

/**
 * Normalize a raw pg timestamptz value (a JS Date at runtime) to a stable
 * ISO-8601 UTC string for equality assertions.
 */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
