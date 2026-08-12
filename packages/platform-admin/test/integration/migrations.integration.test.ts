import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

function testDatabaseUrl(): string {
  const url = process.env.AURORA_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_DATABASE_URL must be set for integration tests');
  }
  return url;
}

/** Verify the target database is the dedicated Aurora test database. */
function assertIsTestDatabase(url: string): void {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/aurora_inbox_test')) {
    throw new Error(`refusing to connect to non-test database: ${parsed.pathname}`);
  }
}

function createTestPool(): Pool {
  const url = testDatabaseUrl();
  assertIsTestDatabase(url);
  return new Pool({ connectionString: url });
}

async function queryRow<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params?: readonly unknown[],
): Promise<T | undefined> {
  const result: QueryResult<T> = await pool.query<T>(sql, params as unknown[] | undefined);
  return result.rows[0];
}

/**
 * Run the platform-admin migrations (this package's directory). The platform
 * identity/processing migrations already live in the shared `pgmigrations`
 * table (created by other packages), so `checkOrder: false` disables
 * node-pg-migrate's cross-directory ordering assertion — same pattern as the
 * platform-audit integration helpers. UP is idempotent: already-applied
 * migrations are skipped.
 */
async function runMigrationsUp(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
    checkOrder: false,
  });
}

async function createTestAccount(pool: Pool, email: string): Promise<string> {
  const result = await pool.query<{ account_id: string }>(
    `INSERT INTO accounts (email, email_normalized, status)
     VALUES ($1, $1, 'active')
     RETURNING account_id`,
    [email.trim().toLowerCase()],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('account insert returned no row');
  return row.account_id;
}

describeDb('platform-admin migrations (real PostgreSQL 17)', () => {
  let pool: Pool | undefined;
  const createdAccountIds: string[] = [];

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runMigrationsUp();
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Remove only rows this suite created, in FK-safe order (the shared test
      // database keeps rows from other packages; never drop tables here).
      await pool.query('DELETE FROM platform_audit_events WHERE actor_account_id = ANY($1)', [
        createdAccountIds,
      ]);
      await pool.query(
        'DELETE FROM platform_admins WHERE account_id = ANY($1) OR granted_by = ANY($1)',
        [createdAccountIds],
      );
      await pool.query('DELETE FROM accounts WHERE account_id = ANY($1)', [createdAccountIds]);
      await pool.end();
    }
  });

  function db(): Pool {
    if (pool === undefined) throw new Error('pool not initialized');
    return pool;
  }

  async function hasTable(name: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      db(),
      `SELECT 1 AS present FROM information_schema.tables
       WHERE table_schema = $1 AND table_name = $2`,
      ['public', name],
    );
    return row !== undefined;
  }

  async function hasIndex(indexName: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      db(),
      'SELECT 1 AS present FROM pg_indexes WHERE indexname = $1',
      [indexName],
    );
    return row !== undefined;
  }

  async function createAccount(): Promise<string> {
    const email = `plt10a-task1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const id = await createTestAccount(db(), email);
    createdAccountIds.push(id);
    return id;
  }

  it('creates the platform_admins and platform_audit_events tables', async () => {
    expect(await hasTable('platform_admins')).toBe(true);
    expect(await hasTable('platform_audit_events')).toBe(true);
    expect(await hasIndex('idx_platform_audit_events_occurred_at')).toBe(true);
  });

  it('enforces a unique platform_admins.account_id', async () => {
    const accountId = await createAccount();
    await db().query(
      'INSERT INTO platform_admins (account_id, granted_by) VALUES ($1, $1)',
      [accountId],
    );
    await expect(
      db().query('INSERT INTO platform_admins (account_id, granted_by) VALUES ($1, $1)', [
        accountId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces the platform_audit_events.action CHECK constraint', async () => {
    const accountId = await createAccount();
    await expect(
      db().query(
        `INSERT INTO platform_audit_events (actor_account_id, action, target, result)
         VALUES ($1, 'illegal_action', '{}'::jsonb, 'succeeded')`,
        [accountId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts a valid platform_audit_events insert', async () => {
    const accountId = await createAccount();
    const row = await queryRow<{ event_id: string }>(
      db(),
      `INSERT INTO platform_audit_events (actor_account_id, action, target, result, request_id)
       VALUES ($1, 'audit_read', '{}'::jsonb, 'succeeded', 'req-123')
       RETURNING event_id`,
      [accountId],
    );
    expect(row?.event_id).toBeTruthy();
  });
});
