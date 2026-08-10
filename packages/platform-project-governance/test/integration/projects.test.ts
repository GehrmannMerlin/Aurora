import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  getProjectById,
  insertProjectMember,
  listProjects,
  updateProjectStatus,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  addTestMember,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  queryRow,
  queryRows,
  resetProjectGovernanceSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;
describeDb('platform-project-governance projects repository (real PostgreSQL 17)', () => {
  let pool: Pool;
  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetProjectGovernanceSchema(pool);
    await runMigrationsUp();
  });
  afterAll(async () => {
    await pool.end();
  });
  async function createOrgWithOwner(): Promise<{ orgId: string; ownerId: string }> {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    return { orgId, ownerId };
  }
  it('createProject atomically creates project + production env + client key + onboarding', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const result = await createProject(pool, {
      orgId,
      name: 'Web App',
      frameworkType: 'react',
      websiteUrl: 'https://example.com',
      createdBy: ownerId,
    });
    expect(result.status).toBe('success');

    const project = await queryRow<{
      name: string;
      framework_type: string;
      website_url: string | null;
      status: string;
      created_by: string;
    }>(
      pool,
      'SELECT name, framework_type, website_url, status, created_by FROM projects WHERE project_id = $1',
      [result.projectId],
    );
    expect(project?.name).toBe('Web App');
    expect(project?.framework_type).toBe('react');
    expect(project?.website_url).toBe('https://example.com');
    expect(project?.status).toBe('active');
    expect(project?.created_by).toBe(ownerId);
    const env = await queryRow<{ environment_id: string; name: string; is_default: boolean }>(
      pool,
      'SELECT environment_id, name, is_default FROM project_environments WHERE project_id = $1',
      [result.projectId],
    );
    expect(env?.environment_id).toBe(result.environmentId);
    expect(env?.name).toBe('production');
    expect(env?.is_default).toBe(true);
    const key = await queryRow<{
      client_key_id: string;
      public_identifier: string;
      key_digest: string;
      enabled: boolean;
    }>(
      pool,
      'SELECT client_key_id, public_identifier, key_digest, enabled FROM client_keys WHERE project_id = $1',
      [result.projectId],
    );
    expect(key?.client_key_id).toBe(result.clientKeyId);
    expect(key?.enabled).toBe(true);
    // public_identifier = aurora_key_<base64url(8)> (11 chars)
    expect(key?.public_identifier).toMatch(/^aurora_key_[A-Za-z0-9_-]{11}$/);
    // only the SHA-256 digest is persisted (64 hex chars)
    expect(key?.key_digest).toMatch(/^[a-f0-9]{64}$/);
    const onboarding = await queryRow<{ status: string; current_step: number }>(
      pool,
      'SELECT status, current_step FROM project_onboarding WHERE project_id = $1',
      [result.projectId],
    );
    expect(onboarding?.status).toBe('not_started');
    expect(onboarding?.current_step).toBe(0);
  });
  it('createProject never persists a client-key secret column', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    await createProject(pool, {
      orgId,
      name: 'Secret Probe',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });
    const columns = await queryRows<{ column_name: string }>(
      pool,
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'client_keys'",
    );
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('secret');
    expect(names).not.toContain('key_secret');
    expect(names).not.toContain('plaintext');
  });
  it('createProject is atomic: a forced mid-transaction failure inserts no partial rows', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    await pool.query(`CREATE OR REPLACE FUNCTION force_client_key_fail() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced client key failure';
      END;
      $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER force_client_key_fail_trigger
      BEFORE INSERT ON client_keys FOR EACH ROW EXECUTE FUNCTION force_client_key_fail()`);
    try {
      await expect(
        createProject(pool, {
          orgId,
          name: 'Atomic',
          frameworkType: 'vue',
          createdBy: ownerId,
        }),
      ).rejects.toMatchObject({ kind: 'statement_failed' });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS force_client_key_fail_trigger ON client_keys');
      await pool.query('DROP FUNCTION IF EXISTS force_client_key_fail()');
    }
    const projects = await queryRow<{ count: number }>(
      pool,
      'SELECT count(*)::int AS count FROM projects WHERE organization_id = $1',
      [orgId],
    );
    expect(projects?.count ?? 0).toBe(0);
    // Scoped through the (rolled-back) project so prior tests' rows don't leak.
    const envs = await queryRow<{ count: number }>(
      pool,
      'SELECT count(*)::int AS count FROM project_environments e JOIN projects p ON p.project_id = e.project_id WHERE p.organization_id = $1',
      [orgId],
    );
    expect(envs?.count ?? 0).toBe(0);
    const keys = await queryRow<{ count: number }>(
      pool,
      'SELECT count(*)::int AS count FROM client_keys ck JOIN projects p ON p.project_id = ck.project_id WHERE p.organization_id = $1',
      [orgId],
    );
    expect(keys?.count ?? 0).toBe(0);
    const onboarding = await queryRow<{ count: number }>(
      pool,
      'SELECT count(*)::int AS count FROM project_onboarding o JOIN projects p ON p.project_id = o.project_id WHERE p.organization_id = $1',
      [orgId],
    );
    expect(onboarding?.count ?? 0).toBe(0);
  });
  it('createProject rejects an out-of-range project name', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    await expect(
      createProject(pool, { orgId, name: 'x', frameworkType: 'javascript', createdBy: ownerId }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });
  it('listProjects: owner and admin see all org projects; a plain member sees only assigned ones', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const adminId = await createTestAccount(pool, `admin-${crypto.randomUUID()}@example.com`);
    const memberId = await createTestAccount(pool, `member-${crypto.randomUUID()}@example.com`);
    await addTestMember(pool, orgId, adminId, 'admin');
    await addTestMember(pool, orgId, memberId, 'member');
    const a = await createProject(pool, {
      orgId,
      name: 'Project A',
      frameworkType: 'react',
      createdBy: ownerId,
    });
    const b = await createProject(pool, {
      orgId,
      name: 'Project B',
      frameworkType: 'vue',
      createdBy: ownerId,
    });

    await insertProjectMember(pool, {
      orgId,
      projectId: b.projectId,
      accountId: memberId,
      role: 'developer',
    });
    const ownerProjects = await listProjects(pool, { orgId, accountId: ownerId });
    expect(ownerProjects.map((p) => p.projectId).sort()).toEqual([a.projectId, b.projectId].sort());
    const adminProjects = await listProjects(pool, { orgId, accountId: adminId });
    expect(adminProjects.map((p) => p.projectId).sort()).toEqual([a.projectId, b.projectId].sort());
    const memberProjects = await listProjects(pool, { orgId, accountId: memberId });
    expect(memberProjects.map((p) => p.projectId)).toEqual([b.projectId]);
  });
  it('getProjectById returns the project projection or null', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Read Me',
      frameworkType: 'other',
      createdBy: ownerId,
    });
    const project = await getProjectById(pool, { orgId, projectId: created.projectId });
    expect(project?.name).toBe('Read Me');
    expect(project?.status).toBe('active');
    expect(await getProjectById(pool, { orgId, projectId: crypto.randomUUID() })).toBeNull();
  });
  it('updateProjectStatus archives an active project and writes audit', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Archive Me',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });
    const result = await updateProjectStatus(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(result).toEqual({
      status: 'success',
      projectId: created.projectId,
      fromStatus: 'active',
      toStatus: 'archived',
    });
    const project = await getProjectById(pool, { orgId, projectId: created.projectId });
    expect(project?.status).toBe('archived');
    expect(project?.archivedAt).not.toBeNull();
    const audit = await queryRows<{ action: string }>(
      pool,
      "SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'project.archived'",
      [orgId],
    );
    expect(audit).toHaveLength(1);
  });
  it('updateProjectStatus is idempotent for an already-archived project', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Archive Twice',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });
    await updateProjectStatus(pool, { orgId, projectId: created.projectId, actorId: ownerId });
    const second = await updateProjectStatus(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(second).toEqual({
      status: 'success',
      projectId: created.projectId,
      fromStatus: 'archived',
      toStatus: 'archived',
    });
  });
  it('updateProjectStatus returns not_found for an unknown project', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const result = await updateProjectStatus(pool, {
      orgId,
      projectId: crypto.randomUUID(),
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'not_found' });
  });
  it('updateProjectStatus rejects archiving a project that is not active or archived', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Trashed',
      frameworkType: 'react',
      createdBy: ownerId,
    });
    await pool.query(`UPDATE projects SET status = 'trash' WHERE project_id = $1`, [
      created.projectId,
    ]);
    const result = await updateProjectStatus(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'state_machine_conflict', currentStatus: 'trash' });
  });
  it('insertProjectMember validates project role and membership', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const memberId = await createTestAccount(pool, `member-${crypto.randomUUID()}@example.com`);
    await addTestMember(pool, orgId, memberId, 'member');
    const created = await createProject(pool, {
      orgId,
      name: 'Grants',
      frameworkType: 'react',
      createdBy: ownerId,
    });

    await expect(
      insertProjectMember(pool, {
        orgId,
        projectId: created.projectId,
        accountId: memberId,
        role: 'not_a_role' as never,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    const inserted = await insertProjectMember(pool, {
      orgId,
      projectId: created.projectId,
      accountId: memberId,
      role: 'read_only',
    });
    expect(inserted).toEqual({
      status: 'success',
      projectId: created.projectId,
      accountId: memberId,
      role: 'read_only',
    });
    const duplicate = await insertProjectMember(pool, {
      orgId,
      projectId: created.projectId,
      accountId: memberId,
      role: 'developer',
    });
    expect(duplicate).toEqual({ status: 'already_member' });
    const notInOrg = await createTestAccount(pool, `outsider-${crypto.randomUUID()}@example.com`);
    const foreign = await insertProjectMember(pool, {
      orgId,
      projectId: created.projectId,
      accountId: notInOrg,
      role: 'project_admin',
    });
    expect(foreign).toEqual({ status: 'not_found' });
    const unknownProject = await insertProjectMember(pool, {
      orgId,
      projectId: crypto.randomUUID(),
      accountId: memberId,
      role: 'project_admin',
    });
    expect(unknownProject).toEqual({ status: 'not_found' });
  });
});
