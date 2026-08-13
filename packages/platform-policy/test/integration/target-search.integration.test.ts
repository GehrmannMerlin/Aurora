import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchPolicyTargets } from '../../src/index.js';

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
 * table; `checkOrder: false` for the shared cross-directory history).
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

/** True when a list of names is sorted ascending (PostgreSQL text order). */
function isAscending(names: readonly string[]): boolean {
  for (let index = 1; index < names.length; index += 1) {
    const previous = names[index - 1] as string;
    const current = names[index] as string;
    if (previous > current) return false;
  }
  return true;
}

describeDb('platform-policy target search (real PostgreSQL 17)', () => {
  let pool: Pool | undefined;
  const createdAccountIds: string[] = [];
  const createdOrganizationIds: string[] = [];
  const createdProjectIds: string[] = [];

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = new Pool({ connectionString: testDatabaseUrl() });
    await runMigrationsUp();
    // Hermetic start: this suite shares the test database with other packages.
    // The search reads the identity/governance tables directly; leftover rows
    // from prior suites are tolerated because every assertion uses a unique
    // name prefix (or bound/determinism-only assertions for the empty query).
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Remove only rows this suite created, in FK-safe order (the shared test
      // database keeps rows from other packages; never drop tables here).
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
    const email = `plt10b-task3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
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

  async function createOrganization(
    name: string,
    kind: 'personal' | 'organization' = 'organization',
  ): Promise<string> {
    const result = await db().query<{ organization_id: string }>(
      `INSERT INTO organizations (name, kind)
       VALUES ($1, $2)
       RETURNING organization_id`,
      [name, kind],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('organization insert returned no row');
    createdOrganizationIds.push(row.organization_id);
    return row.organization_id;
  }

  async function createProject(
    organizationId: string,
    createdBy: string,
    name: string,
    status: 'active' | 'archived' | 'trash' | 'deleting' = 'active',
  ): Promise<string> {
    const result = await db().query<{ project_id: string }>(
      `INSERT INTO projects (organization_id, name, framework_type, created_by, status)
       VALUES ($1, $2, 'other', $3, $4)
       RETURNING project_id`,
      [organizationId, name, createdBy, status],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('project insert returned no row');
    createdProjectIds.push(row.project_id);
    return row.project_id;
  }

  /** Unique name-prefix per test run so cross-suite rows never interfere. */
  function uniquePrefix(label: string): string {
    return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  it('matches targets by name prefix and applies kind/status filters', async () => {
    const prefix = uniquePrefix('match');
    const createdBy = await createAccount();
    const orgId = await createOrganization(`${prefix}-alpha`, 'organization');
    await createOrganization(`${prefix}-beta`, 'personal'); // excluded: kind
    await createOrganization(`other-${prefix}`, 'organization'); // excluded: prefix mismatch
    await createProject(orgId, createdBy, `${prefix}-gamma`, 'active');
    await createProject(orgId, createdBy, `${prefix}-delta`, 'archived');
    await createProject(orgId, createdBy, `${prefix}-epsilon`, 'trash'); // excluded: status
    await createProject(orgId, createdBy, `${prefix}-zeta`, 'deleting'); // excluded: status

    const result = await searchPolicyTargets(db(), { query: prefix, limit: 50 });

    expect(result.organizations).toEqual([{ organizationId: orgId, name: `${prefix}-alpha` }]);
    expect(result.projects.map((project) => project.name)).toEqual([
      `${prefix}-delta`,
      `${prefix}-gamma`,
    ]);
    expect(result.projects.map((project) => project.organizationId)).toEqual([orgId, orgId]);
  });

  it('matches names case-insensitively (ILIKE)', async () => {
    const prefix = uniquePrefix('case');
    await createOrganization(`${prefix}-MiXeD`, 'organization');

    const result = await searchPolicyTargets(db(), {
      query: `${prefix}-mixed`.toLowerCase(),
      limit: 50,
    });

    expect(result.organizations.map((organization) => organization.name)).toEqual([
      `${prefix}-MiXeD`,
    ]);
  });

  it('treats % and _ in the query literally', async () => {
    const prefix = uniquePrefix('escape');
    await createOrganization(`${prefix}-100%_sure`, 'organization');
    await createOrganization(`${prefix}-100X_sure`, 'organization'); // wildcard trap
    await createOrganization(`${prefix}-a_b`, 'organization');
    await createOrganization(`${prefix}-axb`, 'organization'); // underscore trap

    // Literal %: the query matches only the row containing a literal '%', not
    // the '100X' row that an unescaped '%' wildcard would also match.
    const percentResult = await searchPolicyTargets(db(), {
      query: `${prefix}-100%`,
      limit: 50,
    });
    expect(percentResult.organizations.map((organization) => organization.name)).toEqual([
      `${prefix}-100%_sure`,
    ]);

    // Literal _: the query matches only the literal-underscore row, not the 'x' row.
    const underscoreResult = await searchPolicyTargets(db(), {
      query: `${prefix}-a_b`,
      limit: 50,
    });
    expect(underscoreResult.organizations.map((organization) => organization.name)).toEqual([
      `${prefix}-a_b`,
    ]);

    // The same prefix without metacharacters still matches both underscore rows.
    const broadResult = await searchPolicyTargets(db(), { query: `${prefix}-a`, limit: 50 });
    expect(broadResult.organizations.map((organization) => organization.name)).toEqual([
      `${prefix}-a_b`,
      `${prefix}-axb`,
    ]);
  });

  it('bounds results to the requested limit (default 25, cap 50)', async () => {
    const prefix = uniquePrefix('limit');
    const createdBy = await createAccount();
    // Parent org must NOT match the search prefix so it does not pollute the
    // org result set (zz- sorts after the org-* names anyway).
    const orgId = await createOrganization(`zz-${prefix}-parent`, 'organization');

    const orgNames: string[] = [];
    const projectNames: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      const suffix = String(index).padStart(2, '0');
      orgNames.push(`${prefix}-org-${suffix}`);
      projectNames.push(`${prefix}-proj-${suffix}`);
    }
    for (const name of orgNames) await createOrganization(name, 'organization');
    for (const name of projectNames) await createProject(orgId, createdBy, name, 'active');
    orgNames.sort();
    projectNames.sort();

    // Default limit 25: exactly 25 of each kind, sorted ascending.
    const def = await searchPolicyTargets(db(), { query: prefix });
    expect(def.organizations.map((organization) => organization.name)).toEqual(
      orgNames.slice(0, 25),
    );
    expect(def.projects.map((project) => project.name)).toEqual(projectNames.slice(0, 25));

    // Custom limit 10.
    const ten = await searchPolicyTargets(db(), { query: prefix, limit: 10 });
    expect(ten.organizations.map((organization) => organization.name)).toEqual(
      orgNames.slice(0, 10),
    );
    expect(ten.projects.map((project) => project.name)).toEqual(projectNames.slice(0, 10));

    // Cap 50: all 26 of each kind returned (still bounded).
    const wide = await searchPolicyTargets(db(), { query: prefix, limit: 500 });
    expect(wide.organizations.map((organization) => organization.name)).toEqual(orgNames);
    expect(wide.projects.map((project) => project.name)).toEqual(projectNames);
  });

  it('returns the first limit targets for an empty query (bounded + deterministic + sorted)', async () => {
    const prefix = uniquePrefix('empty');
    const names = [`${prefix}-org-1`, `${prefix}-org-2`];
    for (const name of names) await createOrganization(name, 'organization');

    const first = await searchPolicyTargets(db(), { limit: 2 });
    const second = await searchPolicyTargets(db(), { limit: 2 });

    expect(first).toEqual(second);
    expect(first.organizations.length).toBeLessThanOrEqual(2);
    expect(first.projects.length).toBeLessThanOrEqual(2);
    expect(isAscending(first.organizations.map((organization) => organization.name))).toBe(true);
    expect(isAscending(first.projects.map((project) => project.name))).toBe(true);

    // With a wide limit the empty query still returns rows we created (no name filter).
    const wide = await searchPolicyTargets(db(), { limit: 50 });
    const wideOrgNames = new Set(wide.organizations.map((organization) => organization.name));
    for (const name of names) {
      expect(wideOrgNames.has(name)).toBe(true);
    }
  });

  it('rejects a non-positive limit with invalid_input', async () => {
    for (const limit of [0, -3, 1.5]) {
      await expect(searchPolicyTargets(db(), { limit })).rejects.toMatchObject({
        kind: 'invalid_input',
        message: 'limit must be a positive integer',
      });
    }
  });
});
