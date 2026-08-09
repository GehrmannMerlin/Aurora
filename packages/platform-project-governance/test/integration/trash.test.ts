import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProject,
  getProjectById,
  insertProjectMember,
  listTrash,
  restoreProject,
  trashProject,
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
describeDb('platform-project-governance trash repository (real PostgreSQL 17)', () => {
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
  async function currentResourceVersion(orgId: string, projectId: string): Promise<string> {
    const project = await getProjectById(pool, { orgId, projectId });
    if (project === null) throw new Error('project not found for resource version');
    return project.updatedAt;
  }
  it('trashProject moves a project to trash, disables client keys and writes audit', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'To Trash',
      frameworkType: 'react',
      createdBy: ownerId,
    });

    const result = await trashProject(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.projectId).toBe(created.projectId);
      expect(result.fromStatus).toBe('active');
      expect(result.recoverableUntil).not.toBeNull();
    }
    const project = await getProjectById(pool, { orgId, projectId: created.projectId });
    expect(project?.status).toBe('trash');
    expect(project?.trashedAt).not.toBeNull();
    expect(project?.recoverableUntil).not.toBeNull();
    // Client keys of a trashed project are disabled.
    const key = await queryRow<{ enabled: boolean }>(
      pool,
      'SELECT enabled FROM client_keys WHERE client_key_id = $1',
      [created.clientKeyId],
    );
    expect(key?.enabled).toBe(false);
    const audit = await queryRows<{ action: string }>(
      pool,
      "SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'project.trashed'",
      [orgId],
    );
    expect(audit).toHaveLength(1);
  });
  it('trashProject returns state_machine_conflict for a deleting project', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Deleting Already',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });
    await pool.query(`UPDATE projects SET status = 'deleting' WHERE project_id = $1`, [
      created.projectId,
    ]);
    const result = await trashProject(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'state_machine_conflict', currentStatus: 'deleting' });
  });
  it('listTrash returns only trashed projects', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const a = await createProject(pool, {
      orgId,
      name: 'Keep Active',
      frameworkType: 'other',
      createdBy: ownerId,
    });
    const b = await createProject(pool, {
      orgId,
      name: 'Trash Me',
      frameworkType: 'vue',
      createdBy: ownerId,
    });
    await trashProject(pool, { orgId, projectId: b.projectId, actorId: ownerId });
    const trash = await listTrash(pool, orgId);
    expect(trash.map((p) => p.projectId)).toEqual([b.projectId]);
    // a stays active and is not in trash.
    expect(trash.map((p) => p.projectId)).not.toContain(a.projectId);
    expect(trash[0]?.status).toBe('trash');
    expect(trash[0]?.recoverableUntil).not.toBeNull();
    expect(trash[0]?.trashedAt).not.toBeNull();
  });
  it('archive → trash → restore state machine', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Cycle',
      frameworkType: 'other',
      createdBy: ownerId,
    });

    const archived = await updateProjectStatus(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(archived.status).toBe('success');
    const trashed = await trashProject(pool, {
      orgId,
      projectId: created.projectId,
      actorId: ownerId,
    });
    expect(trashed.status).toBe('success');
    if (trashed.status === 'success') {
      expect(trashed.fromStatus).toBe('archived');
    }
    const resourceVersion = await currentResourceVersion(orgId, created.projectId);
    const restored = await restoreProject(pool, {
      orgId,
      projectId: created.projectId,
      resourceVersion,
      actorId: ownerId,
    });
    expect(restored).toEqual({
      status: 'success',
      projectId: created.projectId,
      projectStatus: 'active',
    });
    const after = await getProjectById(pool, { orgId, projectId: created.projectId });
    expect(after?.status).toBe('active');
    expect(after?.trashedAt).toBeNull();
    expect(after?.recoverableUntil).toBeNull();
    expect(after?.archivedAt).toBeNull();
    const audit = await queryRows<{ action: string }>(
      pool,
      "SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'project.restored'",
      [orgId],
    );
    expect(audit).toHaveLength(1);
  });
  it('restoreProject does NOT re-enable client keys disabled on trash', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Keys Stay Off',
      frameworkType: 'react',
      createdBy: ownerId,
    });
    await trashProject(pool, { orgId, projectId: created.projectId, actorId: ownerId });
    const resourceVersion = await currentResourceVersion(orgId, created.projectId);
    const restored = await restoreProject(pool, {
      orgId,
      projectId: created.projectId,
      resourceVersion,
      actorId: ownerId,
    });
    expect(restored.status).toBe('success');
    const key = await queryRow<{ enabled: boolean }>(
      pool,
      'SELECT enabled FROM client_keys WHERE client_key_id = $1',
      [created.clientKeyId],
    );
    expect(key?.enabled).toBe(false); // NOT re-enabled
  });
  it('restoreProject rejects a deleting project with the current authoritative status', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Deleting',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });
    await pool.query(`UPDATE projects SET status = 'deleting' WHERE project_id = $1`, [
      created.projectId,
    ]);
    const resourceVersion = await currentResourceVersion(orgId, created.projectId);
    const result = await restoreProject(pool, {
      orgId,
      projectId: created.projectId,
      resourceVersion,
      actorId: ownerId,
    });
    expect(result).toEqual({
      status: 'state_machine_conflict',
      currentStatus: 'deleting',
      recoverableUntil: null,
    });
  });
  it('restoreProject rejects an expired recovery window', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Expired',
      frameworkType: 'vue',
      createdBy: ownerId,
    });
    await trashProject(pool, { orgId, projectId: created.projectId, actorId: ownerId });
    await pool.query(
      `UPDATE projects
         SET trashed_at = now() - interval '8 days', recoverable_until = now() - interval '1 day'
       WHERE project_id = $1`,
      [created.projectId],
    );
    const resourceVersion = await currentResourceVersion(orgId, created.projectId);
    const result = await restoreProject(pool, {
      orgId,
      projectId: created.projectId,
      resourceVersion,
      actorId: ownerId,
    });
    expect(result.status).toBe('state_machine_conflict');
    if (result.status === 'state_machine_conflict') {
      expect(result.currentStatus).toBe('trash');
      expect(result.recoverableUntil).not.toBeNull();
    }
    const after = await getProjectById(pool, { orgId, projectId: created.projectId });
    expect(after?.status).toBe('trash'); // untouched
  });
  it('restoreProject returns version_conflict on a stale resource version', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Stale',
      frameworkType: 'react',
      createdBy: ownerId,
    });
    await trashProject(pool, { orgId, projectId: created.projectId, actorId: ownerId });
    const staleVersion = await currentResourceVersion(orgId, created.projectId);
    // Touch updated_at so the client's copy is stale. There is no auto-update
    // trigger on updated_at, so we set it explicitly.
    await pool.query(`UPDATE projects SET updated_at = now() WHERE project_id = $1`, [
      created.projectId,
    ]);
    const currentVersion = await currentResourceVersion(orgId, created.projectId);
    expect(staleVersion).not.toBe(currentVersion);
    const result = await restoreProject(pool, {
      orgId,
      projectId: created.projectId,
      resourceVersion: staleVersion,
      actorId: ownerId,
    });
    expect(result.status).toBe('version_conflict');
    if (result.status === 'version_conflict') {
      expect(result.currentResourceVersion).toBe(currentVersion);
    }
    const after = await getProjectById(pool, { orgId, projectId: created.projectId });
    expect(after?.status).toBe('trash'); // not restored
  });
  it('restoreProject recomputes membership against current org state (no stale snapshot)', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const memberId = await createTestAccount(pool, `member-${crypto.randomUUID()}@example.com`);
    const stayingId = await createTestAccount(pool, `staying-${crypto.randomUUID()}@example.com`);
    await addTestMember(pool, orgId, memberId, 'member');
    await addTestMember(pool, orgId, stayingId, 'member');
    const created = await createProject(pool, {
      orgId,
      name: 'Members',
      frameworkType: 'react',
      createdBy: ownerId,
    });
    await insertProjectMember(pool, {
      orgId,
      projectId: created.projectId,
      accountId: memberId,
      role: 'developer',
    });
    await insertProjectMember(pool, {
      orgId,
      projectId: created.projectId,
      accountId: stayingId,
      role: 'read_only',
    });
    // The member leaves the org before the project is restored.
    await pool.query(
      'DELETE FROM organization_members WHERE organization_id = $1 AND account_id = $2',
      [orgId, memberId],
    );
    await trashProject(pool, { orgId, projectId: created.projectId, actorId: ownerId });
    const resourceVersion = await currentResourceVersion(orgId, created.projectId);
    const restored = await restoreProject(pool, {
      orgId,
      projectId: created.projectId,
      resourceVersion,
      actorId: ownerId,
    });
    expect(restored.status).toBe('success');
    // The departed member's project grant is dropped.
    const stale = await queryRow<{ count: number }>(
      pool,
      'SELECT count(*)::int AS count FROM project_members WHERE project_id = $1 AND account_id = $2',
      [created.projectId, memberId],
    );
    expect(stale?.count ?? 0).toBe(0);
    // The current member's grant is preserved.
    const staying = await queryRow<{ role: string }>(
      pool,
      'SELECT role FROM project_members WHERE project_id = $1 AND account_id = $2',
      [created.projectId, stayingId],
    );
    expect(staying?.role).toBe('read_only');
  });
  it('restoreProject returns not_found for an unknown project', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const result = await restoreProject(pool, {
      orgId,
      projectId: crypto.randomUUID(),
      resourceVersion: '2026-08-09T00:00:00.000Z',
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'not_found' });
  });
});
