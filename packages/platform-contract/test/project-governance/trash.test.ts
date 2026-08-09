import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LIST_TRASH,
  OPERATION_ID_RESTORE_PROJECT,
  projectGovernanceListTrashRequest,
  projectGovernanceListTrashResponse,
  projectGovernanceRestoreProjectRequest,
  projectGovernanceRestoreProjectResponse,
} from '../../src/project-governance/trash.js';

const listResponse = {
  projects: [
    {
      projectId: 'prj_123',
      name: 'Web',
      frameworkType: 'vue',
      trashedAt: '2026-08-01T01:00:00.000Z',
      recoverableUntil: '2026-08-08T01:00:00.000Z',
      lifecycle: 'trash',
    },
  ],
  navigationTargets: [],
};

describe('projectGovernanceListTrash contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_LIST_TRASH).toBe('projectGovernanceListTrash');
  });

  it('accepts a valid trash request', () => {
    expect(
      projectGovernanceListTrashRequest.zod.safeParse({ organizationId: 'org_1' }).success,
    ).toBe(true);
  });

  it('rejects a missing organizationId', () => {
    expect(projectGovernanceListTrashRequest.zod.safeParse({}).success).toBe(false);
  });

  it('accepts a valid trash response', () => {
    expect(projectGovernanceListTrashResponse.zod.safeParse(listResponse).success).toBe(true);
  });

  it('rejects a response carrying an active lifecycle in trash', () => {
    expect(
      projectGovernanceListTrashResponse.zod.safeParse({
        projects: [{ ...listResponse.projects[0], lifecycle: 'active' }],
        navigationTargets: [],
      }).success,
    ).toBe(false);
  });
});

describe('projectGovernanceRestoreProject contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_RESTORE_PROJECT).toBe('projectGovernanceRestoreProject');
  });

  it('accepts a valid restore request', () => {
    expect(
      projectGovernanceRestoreProjectRequest.zod.safeParse({
        resourceVersion: 'v1',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing idempotencyKey', () => {
    expect(
      projectGovernanceRestoreProjectRequest.zod.safeParse({ resourceVersion: 'v1' }).success,
    ).toBe(false);
  });

  it('accepts a valid restore response', () => {
    expect(
      projectGovernanceRestoreProjectResponse.zod.safeParse({
        projectId: 'prj_123',
        status: 'active',
        lifecycle: 'active',
        navigationTargets: [],
      }).success,
    ).toBe(true);
  });

  it('rejects a restore response that is not active', () => {
    expect(
      projectGovernanceRestoreProjectResponse.zod.safeParse({
        projectId: 'prj_123',
        status: 'trash',
        lifecycle: 'trash',
        navigationTargets: [],
      }).success,
    ).toBe(false);
  });
});
