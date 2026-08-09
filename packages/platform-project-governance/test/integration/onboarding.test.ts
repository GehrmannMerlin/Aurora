import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, getOnboarding, updateOnboardingStatus } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  resetProjectGovernanceSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;
describeDb('platform-project-governance onboarding repository (real PostgreSQL 17)', () => {
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
  it('getOnboarding returns the not_started row created atomically', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Onboard',
      frameworkType: 'vue',
      createdBy: ownerId,
    });
    const onboarding = await getOnboarding(pool, created.projectId);
    expect(onboarding?.projectId).toBe(created.projectId);
    expect(onboarding?.status).toBe('not_started');
    expect(onboarding?.currentStep).toBe(0);
    expect(onboarding?.completedAt).toBeNull();
  });
  it('getOnboarding returns null for an unknown project', async () => {
    expect(await getOnboarding(pool, crypto.randomUUID())).toBeNull();
  });
  it('updateOnboardingStatus moves a project through in_progress to completed', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await createProject(pool, {
      orgId,
      name: 'Progress',
      frameworkType: 'javascript',
      createdBy: ownerId,
    });

    const inProgress = await updateOnboardingStatus(pool, {
      projectId: created.projectId,
      status: 'in_progress',
      currentStep: 1,
    });
    expect(inProgress.status).toBe('success');
    if (inProgress.status === 'success') {
      expect(inProgress.onboarding.status).toBe('in_progress');
      expect(inProgress.onboarding.currentStep).toBe(1);
    }
    const completed = await updateOnboardingStatus(pool, {
      projectId: created.projectId,
      status: 'completed',
      currentStep: 2,
    });
    expect(completed.status).toBe('success');
    if (completed.status === 'success') {
      expect(completed.onboarding.status).toBe('completed');
      expect(completed.onboarding.currentStep).toBe(2);
      expect(completed.onboarding.completedAt).not.toBeNull();
    }
  });
  it('updateOnboardingStatus returns not_found for an unknown project', async () => {
    const result = await updateOnboardingStatus(pool, {
      projectId: crypto.randomUUID(),
      status: 'in_progress',
      currentStep: 0,
    });
    expect(result.status).toBe('not_found');
  });
});
