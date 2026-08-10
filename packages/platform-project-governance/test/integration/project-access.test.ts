import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkProjectAccess, createProject, insertProjectMember } from '../../src/index.js';
import {
  assertIsTestDatabase,
  addTestMember,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  resetProjectGovernanceSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-project-governance project access check (real PostgreSQL 17)', () => {
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

  it('an org manager (owner) is allowed regardless of project membership', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    const project = await createProject(pool, {
      orgId,
      name: 'Web App',
      frameworkType: 'react',
      createdBy: ownerId,
    });
    // Owner is NOT a project_members row — the org-manager privilege is enough.
    const result = await checkProjectAccess(pool, {
      organizationId: orgId,
      projectId: project.projectId,
      accountId: ownerId,
    });
    expect(result).toEqual({ outcome: 'allowed' });
  });

  it('a project member (non-manager) is allowed', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const memberId = await createTestAccount(pool, `member-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    await addTestMember(pool, orgId, memberId, 'member');
    const project = await createProject(pool, {
      orgId,
      name: 'Shared',
      frameworkType: 'vue',
      createdBy: ownerId,
    });
    const granted = await insertProjectMember(pool, {
      orgId,
      projectId: project.projectId,
      accountId: memberId,
      role: 'developer',
    });
    expect(granted.status).toBe('success');

    const result = await checkProjectAccess(pool, {
      organizationId: orgId,
      projectId: project.projectId,
      accountId: memberId,
    });
    expect(result).toEqual({ outcome: 'allowed' });
  });

  it('an org member who is not on the project is forbidden', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const outsiderId = await createTestAccount(pool, `outsider-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    await addTestMember(pool, orgId, outsiderId, 'member');
    const project = await createProject(pool, {
      orgId,
      name: 'Private',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });

    const result = await checkProjectAccess(pool, {
      organizationId: orgId,
      projectId: project.projectId,
      accountId: outsiderId,
    });
    expect(result).toEqual({ outcome: 'forbidden' });
  });

  it('an absent project returns not_found', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    const result = await checkProjectAccess(pool, {
      organizationId: orgId,
      projectId: crypto.randomUUID(),
      accountId: ownerId,
    });
    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('a project that belongs to a different org returns not_found (no existence leak)', async () => {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgA = await createTestOrganization(pool, 'Acme A', ownerId);
    const orgB = await createTestOrganization(pool, 'Acme B', ownerId);
    const project = await createProject(pool, {
      orgId: orgA,
      name: 'Scoped',
      frameworkType: 'react',
      createdBy: ownerId,
    });

    // The same account is owner of both orgs, but the project is NOT in orgB.
    const result = await checkProjectAccess(pool, {
      organizationId: orgB,
      projectId: project.projectId,
      accountId: ownerId,
    });
    expect(result).toEqual({ outcome: 'not_found' });
  });
});
