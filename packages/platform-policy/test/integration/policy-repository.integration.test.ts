import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapPlatformDefaultIfAbsent,
  clearProjectLimit,
  getOrganizationOverride,
  getPlatformDefaultPolicy,
  getProjectLimit,
  resetOrganizationOverride,
  setOrganizationOverride,
  setPlatformDefaultPolicy,
  setProjectLimit,
} from '../../src/index.js';

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

/**
 * Run this package's migrations UP (idempotent against the shared `pgmigrations`
 * table; `checkOrder: false` for the shared cross-directory history). Same
 * pattern as the migration integration test and the platform-admin suites.
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

const FIVE_FIELDS = {
  defaultPeriodQuota: 1_000_000,
  warningRatio: 80,
  hardLimit: 100,
  degradationEnabled: true,
  highValueRetentionDays: 90,
} as const;

describeDb('platform-policy repositories (real PostgreSQL 17)', () => {
  let pool: Pool | undefined;
  const createdAccountIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = new Pool({ connectionString: testDatabaseUrl() });
    await runMigrationsUp();
    // Hermetic start: this package shares one test database with every other
    // suite. Leftover policy rows from a prior suite would break the
    // single-row default and the version assertions, so truncate the three
    // policy tables at start (same start-of-suite truncate pattern as the
    // platform-admin admins suite).
    await pool.query(
      'TRUNCATE platform_resource_policies, organization_policy_overrides, project_policy_limits',
    );
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
      await pool.query('DELETE FROM platform_resource_policies WHERE updated_by = ANY($1)', [
        createdAccountIds,
      ]);
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

  async function createAccount(): Promise<string> {
    const email = `plt10b-task2-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const result = await db().query<{ account_id: string }>(
      `INSERT INTO accounts (email, email_normalized, status)
       VALUES ($1, $1, 'active')
       RETURNING account_id`,
      [email.trim().toLowerCase()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('account insert returned no row');
    createdAccountIds.push(row.account_id);
    return row.account_id;
  }

  async function createOrganization(): Promise<string> {
    const name = `plt10b-task2-org-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await db().query<{ organization_id: string }>(
      `INSERT INTO organizations (name, kind)
       VALUES ($1, 'organization')
       RETURNING organization_id`,
      [name],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('organization insert returned no row');
    createdOrganizationIds.push(row.organization_id);
    return row.organization_id;
  }

  async function createProject(organizationId: string, createdBy: string): Promise<string> {
    const name = `plt10b-task2-proj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await db().query<{ project_id: string }>(
      `INSERT INTO projects (organization_id, name, framework_type, created_by, status)
       VALUES ($1, $2, 'other', $3, 'active')
       RETURNING project_id`,
      [organizationId, name, createdBy],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('project insert returned no row');
    createdProjectIds.push(row.project_id);
    return row.project_id;
  }

  /** Reset the single-row platform default table for a self-contained test. */
  async function clearDefaultRow(): Promise<void> {
    await db().query('DELETE FROM platform_resource_policies');
  }

  it('bootstraps the platform default with suggested defaults and is idempotent', async () => {
    const alice = await createAccount();

    expect(await getPlatformDefaultPolicy(db())).toBeNull();
    expect(await bootstrapPlatformDefaultIfAbsent(db(), { actorAccountId: alice })).toEqual({
      status: 'created',
    });
    expect(await bootstrapPlatformDefaultIfAbsent(db(), { actorAccountId: alice })).toEqual({
      status: 'already_exists',
    });

    const policy = await getPlatformDefaultPolicy(db());
    expect(policy).toMatchObject({
      defaultPeriodQuota: 1_000_000,
      warningRatio: 80,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 90,
      policySource: 'system_default',
      version: 1,
      updatedBy: alice,
    });
    expect(policy?.updatedAt).toBeTruthy();
  });

  it('sets the platform default via INSERT when no row exists', async () => {
    const alice = await createAccount();
    await clearDefaultRow();

    const result = await setPlatformDefaultPolicy(db(), {
      defaultPeriodQuota: 750_000,
      warningRatio: 60,
      hardLimit: 95,
      degradationEnabled: false,
      highValueRetentionDays: 60,
      expectedVersion: 0,
      actorAccountId: alice,
    });
    expect(result).toEqual({ status: 'set', version: 1 });

    const policy = await getPlatformDefaultPolicy(db());
    expect(policy).toMatchObject({
      defaultPeriodQuota: 750_000,
      warningRatio: 60,
      hardLimit: 95,
      degradationEnabled: false,
      highValueRetentionDays: 60,
      policySource: 'platform_admin',
      version: 1,
      updatedBy: alice,
    });
  });

  it('updates the platform default with optimistic versioning', async () => {
    const alice = await createAccount();
    await clearDefaultRow();
    await setPlatformDefaultPolicy(db(), { ...FIVE_FIELDS, expectedVersion: 0, actorAccountId: alice });

    expect(
      await setPlatformDefaultPolicy(db(), {
        defaultPeriodQuota: 900_000,
        warningRatio: 75,
        hardLimit: 98,
        degradationEnabled: true,
        highValueRetentionDays: 80,
        expectedVersion: 1,
        actorAccountId: alice,
      }),
    ).toEqual({ status: 'set', version: 2 });

    expect(
      await setPlatformDefaultPolicy(db(), {
        ...FIVE_FIELDS,
        expectedVersion: 1,
        actorAccountId: alice,
      }),
    ).toEqual({ status: 'version_conflict' });
  });

  it('rejects an invalid warning/hard ratio with invalid_input', async () => {
    const alice = await createAccount();
    await clearDefaultRow();

    await expect(
      setPlatformDefaultPolicy(db(), {
        defaultPeriodQuota: 1_000_000,
        warningRatio: 95,
        hardLimit: 50,
        degradationEnabled: true,
        highValueRetentionDays: 90,
        expectedVersion: 0,
        actorAccountId: alice,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input', message: 'invalid_ratio_order' });
  });

  it('sets an organization override via INSERT and reads it back', async () => {
    const alice = await createAccount();
    const org = await createOrganization();

    const result = await setOrganizationOverride(db(), {
      organizationId: org,
      defaultPeriodQuota: 500_000,
      warningRatio: 70,
      hardLimit: 90,
      degradationEnabled: false,
      highValueRetentionDays: 45,
      expectedVersion: 0,
      actorAccountId: alice,
    });
    expect(result).toEqual({ status: 'set', version: 1 });

    const override = await getOrganizationOverride(db(), { organizationId: org });
    expect(override).toMatchObject({
      organizationId: org,
      defaultPeriodQuota: 500_000,
      warningRatio: 70,
      hardLimit: 90,
      degradationEnabled: false,
      highValueRetentionDays: 45,
      policySource: 'platform_admin',
      version: 1,
      updatedBy: alice,
    });
  });

  it('updates an organization override with optimistic versioning', async () => {
    const alice = await createAccount();
    const org = await createOrganization();
    await setOrganizationOverride(db(), { organizationId: org, ...FIVE_FIELDS, expectedVersion: 0, actorAccountId: alice });

    expect(
      await setOrganizationOverride(db(), {
        organizationId: org,
        defaultPeriodQuota: 400_000,
        warningRatio: 65,
        hardLimit: 88,
        degradationEnabled: true,
        highValueRetentionDays: 30,
        expectedVersion: 1,
        actorAccountId: alice,
      }),
    ).toEqual({ status: 'set', version: 2 });

    expect(
      await setOrganizationOverride(db(), {
        organizationId: org,
        ...FIVE_FIELDS,
        expectedVersion: 1,
        actorAccountId: alice,
      }),
    ).toEqual({ status: 'version_conflict' });
  });

  it('returns organization_not_found for a missing organization', async () => {
    const alice = await createAccount();
    const missing = '00000000-0000-4000-8000-000000000030';

    const result = await setOrganizationOverride(db(), {
      organizationId: missing,
      ...FIVE_FIELDS,
      expectedVersion: 0,
      actorAccountId: alice,
    });
    expect(result).toEqual({ status: 'organization_not_found' });
  });

  it('returns temporarily_unavailable for a missing actor', async () => {
    const org = await createOrganization();
    const missingActor = '00000000-0000-4000-8000-000000000031';

    const result = await setOrganizationOverride(db(), {
      organizationId: org,
      ...FIVE_FIELDS,
      expectedVersion: 0,
      actorAccountId: missingActor,
    });
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });

  it('resets an organization override (no row is a success; versioned delete)', async () => {
    const alice = await createAccount();
    const org = await createOrganization();

    expect(
      await resetOrganizationOverride(db(), { organizationId: org, expectedVersion: 0, actorAccountId: alice }),
    ).toEqual({ status: 'reset' });

    await setOrganizationOverride(db(), { organizationId: org, ...FIVE_FIELDS, expectedVersion: 0, actorAccountId: alice });
    expect(
      await resetOrganizationOverride(db(), { organizationId: org, expectedVersion: 99, actorAccountId: alice }),
    ).toEqual({ status: 'version_conflict' });

    expect(
      await resetOrganizationOverride(db(), { organizationId: org, expectedVersion: 1, actorAccountId: alice }),
    ).toEqual({ status: 'reset' });
    expect(await getOrganizationOverride(db(), { organizationId: org })).toBeNull();
  });

  it('sets and updates a project resource limit with versioning', async () => {
    const alice = await createAccount();
    const org = await createOrganization();
    const project = await createProject(org, alice);

    expect(
      await setProjectLimit(db(), { projectId: project, resourceLimit: 100_000, expectedVersion: 0, actorAccountId: alice }),
    ).toEqual({ status: 'set', version: 1 });

    const limit = await getProjectLimit(db(), { projectId: project });
    expect(limit).toMatchObject({
      projectId: project,
      resourceLimit: 100_000,
      policySource: 'platform_admin',
      version: 1,
      updatedBy: alice,
    });

    expect(
      await setProjectLimit(db(), { projectId: project, resourceLimit: 200_000, expectedVersion: 1, actorAccountId: alice }),
    ).toEqual({ status: 'set', version: 2 });

    expect(
      await setProjectLimit(db(), { projectId: project, resourceLimit: 300_000, expectedVersion: 1, actorAccountId: alice }),
    ).toEqual({ status: 'version_conflict' });
  });

  it('returns project_not_found / temporarily_unavailable for missing targets', async () => {
    const alice = await createAccount();
    const org = await createOrganization();
    const project = await createProject(org, alice);
    const missingProject = '00000000-0000-4000-8000-000000000032';
    const missingActor = '00000000-0000-4000-8000-000000000033';

    expect(
      await setProjectLimit(db(), { projectId: missingProject, resourceLimit: 50_000, expectedVersion: 0, actorAccountId: alice }),
    ).toEqual({ status: 'project_not_found' });
    expect(
      await setProjectLimit(db(), { projectId: project, resourceLimit: 50_000, expectedVersion: 0, actorAccountId: missingActor }),
    ).toEqual({ status: 'temporarily_unavailable' });
  });

  it('rejects a non-positive resource limit with invalid_input', async () => {
    const alice = await createAccount();
    const org = await createOrganization();
    const project = await createProject(org, alice);

    await expect(
      setProjectLimit(db(), { projectId: project, resourceLimit: 0, expectedVersion: 0, actorAccountId: alice }),
    ).rejects.toMatchObject({ kind: 'invalid_input', message: 'invalid_resource_limit' });
  });

  it('clears a project resource limit (no row is a success; versioned delete)', async () => {
    const alice = await createAccount();
    const org = await createOrganization();
    const project = await createProject(org, alice);

    expect(
      await clearProjectLimit(db(), { projectId: project, expectedVersion: 0, actorAccountId: alice }),
    ).toEqual({ status: 'cleared' });

    await setProjectLimit(db(), { projectId: project, resourceLimit: 80_000, expectedVersion: 0, actorAccountId: alice });
    expect(
      await clearProjectLimit(db(), { projectId: project, expectedVersion: 99, actorAccountId: alice }),
    ).toEqual({ status: 'version_conflict' });

    expect(
      await clearProjectLimit(db(), { projectId: project, expectedVersion: 1, actorAccountId: alice }),
    ).toEqual({ status: 'cleared' });
    expect(await getProjectLimit(db(), { projectId: project })).toBeNull();
  });
});
