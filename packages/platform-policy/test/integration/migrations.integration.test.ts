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
 * Run the platform-policy migrations (this package's directory). The platform
 * identity/processing migrations already live in the shared `pgmigrations`
 * table (created by other packages), so `checkOrder: false` disables
 * node-pg-migrate's cross-directory ordering assertion — same pattern as the
 * platform-admin integration helpers. UP is idempotent: already-applied
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

async function createTestOrganization(pool: Pool, name: string): Promise<string> {
  const result = await pool.query<{ organization_id: string }>(
    `INSERT INTO organizations (name, kind)
     VALUES ($1, 'organization')
     RETURNING organization_id`,
    [name],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('organization insert returned no row');
  return row.organization_id;
}

async function createTestProject(
  pool: Pool,
  organizationId: string,
  createdBy: string,
  name: string,
): Promise<string> {
  const result = await pool.query<{ project_id: string }>(
    `INSERT INTO projects (organization_id, name, framework_type, created_by, status)
     VALUES ($1, $2, 'other', $3, 'active')
     RETURNING project_id`,
    [organizationId, name, createdBy],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('project insert returned no row');
  return row.project_id;
}

describeDb('platform-policy migrations (real PostgreSQL 17)', () => {
  let pool: Pool | undefined;
  const createdAccountIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runMigrationsUp();
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Remove only rows this suite created, in FK-safe order (the shared test
      // database keeps rows from other packages; never drop tables here).
      await pool.query('DELETE FROM project_policy_limits WHERE project_id = ANY($1)', [
        createdProjectIds,
      ]);
      await pool.query(
        'DELETE FROM organization_policy_overrides WHERE organization_id = ANY($1)',
        [createdOrganizationIds],
      );
      await pool.query('DELETE FROM projects WHERE project_id = ANY($1)', [createdProjectIds]);
      await pool.query('DELETE FROM organizations WHERE organization_id = ANY($1)', [
        createdOrganizationIds,
      ]);
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

  async function createAccount(): Promise<string> {
    const email = `plt10b-task1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const id = await createTestAccount(db(), email);
    createdAccountIds.push(id);
    return id;
  }

  async function createOrganization(): Promise<string> {
    const name = `plt10b-task1-org-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const id = await createTestOrganization(db(), name);
    createdOrganizationIds.push(id);
    return id;
  }

  async function createProject(organizationId: string, accountId: string): Promise<string> {
    const name = `plt10b-task1-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const id = await createTestProject(db(), organizationId, accountId, name);
    createdProjectIds.push(id);
    return id;
  }

  const VALID_OVERRIDE_FIELDS = `default_period_quota, warning_ratio, hard_limit, degradation_enabled, high_value_retention_days, policy_source`;

  it('creates the three platform resource policy tables', async () => {
    expect(await hasTable('platform_resource_policies')).toBe(true);
    expect(await hasTable('organization_policy_overrides')).toBe(true);
    expect(await hasTable('project_policy_limits')).toBe(true);
  });

  it('enforces the platform_resource_policies ratio CHECK', async () => {
    await expect(
      db().query(
        `INSERT INTO platform_resource_policies
           (default_period_quota, warning_ratio, hard_limit, degradation_enabled, high_value_retention_days, policy_source)
         VALUES (1000000, 90, 50, true, 90, 'system_default')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces a unique organization_policy_overrides.organization_id', async () => {
    const organizationId = await createOrganization();
    await db().query(
      `INSERT INTO organization_policy_overrides (organization_id, ${VALID_OVERRIDE_FIELDS})
       VALUES ($1, 1000000, 80, 100, true, 90, 'platform_admin')`,
      [organizationId],
    );
    await expect(
      db().query(
        `INSERT INTO organization_policy_overrides (organization_id, ${VALID_OVERRIDE_FIELDS})
         VALUES ($1, 1000000, 80, 100, true, 90, 'platform_admin')`,
        [organizationId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces the organization_policy_overrides ratio CHECK', async () => {
    const organizationId = await createOrganization();
    await expect(
      db().query(
        `INSERT INTO organization_policy_overrides (organization_id, ${VALID_OVERRIDE_FIELDS})
         VALUES ($1, 1000000, 90, 50, true, 90, 'platform_admin')`,
        [organizationId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces a unique project_policy_limits.project_id', async () => {
    const accountId = await createAccount();
    const organizationId = await createOrganization();
    const projectId = await createProject(organizationId, accountId);
    await db().query(
      `INSERT INTO project_policy_limits (project_id, resource_limit, policy_source)
       VALUES ($1, 100000, 'platform_admin')`,
      [projectId],
    );
    await expect(
      db().query(
        `INSERT INTO project_policy_limits (project_id, resource_limit, policy_source)
         VALUES ($1, 100000, 'platform_admin')`,
        [projectId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces the project_policy_limits.resource_limit CHECK', async () => {
    const accountId = await createAccount();
    const organizationId = await createOrganization();
    const projectId = await createProject(organizationId, accountId);
    await expect(
      db().query(
        `INSERT INTO project_policy_limits (project_id, resource_limit, policy_source)
         VALUES ($1, 0, 'platform_admin')`,
        [projectId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
