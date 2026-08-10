import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getOnboarding } from '../src/repositories/onboarding.js';
import {
  getProjectAccessRole,
  getProjectById,
  insertProjectMember,
  updateProjectStatus,
} from '../src/repositories/projects.js';

/** Minimal fake PoolClient that returns a fixed row set from `query`. */
function fakeClient(rows: unknown[]): PoolClient {
  return {
    query: () => Promise.resolve({ rows }),
    release: () => Promise.resolve(),
  } as unknown as PoolClient;
}

/** Fake PoolClient that replays a sequence of responses (rows or thrown errors). */
function fakeClientSequence(responses: ({ readonly rows?: unknown[] } | Error)[]): PoolClient {
  let index = 0;
  return {
    query: () => {
      const response = responses[index];
      index += 1;
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve({ rows: response.rows ?? [] });
    },
    release: () => Promise.resolve(),
  } as unknown as PoolClient;
}

describe('getOnboarding (fake client)', () => {
  it('returns null when the project has no onboarding row (missing ≠ zero)', async () => {
    const result = await getOnboarding(fakeClient([]), 'prj_missing');
    expect(result).toBeNull();
  });

  it('maps a present row to the safe onboarding projection', async () => {
    const row = {
      project_id: 'prj_1',
      status: 'in_progress',
      current_step: 'step_2',
      updated_at: '2026-08-10T00:00:00.000Z',
    };
    const result = await getOnboarding(fakeClient([row]), 'prj_1');
    expect(result).not.toBeNull();
    expect(result?.projectId).toBe('prj_1');
  });
});

describe('getProjectById (fake client)', () => {
  it('returns null when the project is not found (missing ≠ zero)', async () => {
    const result = await getProjectById(fakeClient([]), {
      orgId: 'org_1',
      projectId: 'prj_missing',
    });
    expect(result).toBeNull();
  });
});

describe('updateProjectStatus (fake client)', () => {
  it('returns not_found when the project does not exist', async () => {
    const result = await updateProjectStatus(fakeClient([]), {
      orgId: 'org_1',
      projectId: 'prj_missing',
      actorId: 'acc_1',
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('rejects archiving a project that is not active or archived', async () => {
    const result = await updateProjectStatus(fakeClient([{ status: 'pending' }]), {
      orgId: 'org_1',
      projectId: 'prj_1',
      actorId: 'acc_1',
    });
    expect(result).toEqual({ status: 'state_machine_conflict', currentStatus: 'pending' });
  });

  it('treats an already-archived project as an idempotent success', async () => {
    const result = await updateProjectStatus(fakeClient([{ status: 'archived' }]), {
      orgId: 'org_1',
      projectId: 'prj_1',
      actorId: 'acc_1',
    });
    expect(result).toEqual({
      status: 'success',
      projectId: 'prj_1',
      fromStatus: 'archived',
      toStatus: 'archived',
    });
  });

  it('archives an active project and reports the from/to transition', async () => {
    const result = await updateProjectStatus(fakeClient([{ status: 'active' }]), {
      orgId: 'org_1',
      projectId: 'prj_1',
      actorId: 'acc_1',
    });
    expect(result).toEqual({
      status: 'success',
      projectId: 'prj_1',
      fromStatus: 'active',
      toStatus: 'archived',
    });
  });
});

describe('getProjectAccessRole (fake client)', () => {
  it('reports not_found when the project is outside the organization', async () => {
    const result = await getProjectAccessRole(fakeClient([{ organization_id: 'other_org' }]), {
      organizationId: 'org_1',
      projectId: 'prj_1',
      accountId: 'acc_1',
    });
    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('allows an org manager as project_admin without a membership row', async () => {
    const result = await getProjectAccessRole(
      fakeClientSequence([
        { rows: [{ organization_id: 'org_1' }] },
        { rows: [{ is_manager: true }] },
      ]),
      { organizationId: 'org_1', projectId: 'prj_1', accountId: 'acc_1' },
    );
    expect(result).toEqual({ outcome: 'allowed', role: 'project_admin' });
  });

  it('allows a developer via their project membership role', async () => {
    const result = await getProjectAccessRole(
      fakeClientSequence([
        { rows: [{ organization_id: 'org_1' }] },
        { rows: [{ is_manager: false }] },
        { rows: [{ role: 'developer' }] },
      ]),
      { organizationId: 'org_1', projectId: 'prj_1', accountId: 'acc_1' },
    );
    expect(result).toEqual({ outcome: 'allowed', role: 'developer' });
  });

  it('forbids an account with no org manager role and no project membership', async () => {
    const result = await getProjectAccessRole(
      fakeClientSequence([
        { rows: [{ organization_id: 'org_1' }] },
        { rows: [{ is_manager: false }] },
        { rows: [] },
      ]),
      { organizationId: 'org_1', projectId: 'prj_1', accountId: 'acc_1' },
    );
    expect(result).toEqual({ outcome: 'forbidden' });
  });
});

describe('insertProjectMember (fake client)', () => {
  it('returns not_found when the project or membership does not exist', async () => {
    const result = await insertProjectMember(fakeClientSequence([{ rows: [] }, { rows: [] }]), {
      orgId: 'org_1',
      projectId: 'prj_1',
      accountId: 'acc_1',
      role: 'developer',
    });
    expect(result).toEqual({ status: 'not_found' });
  });

  it('returns already_member on a unique-violation insert', async () => {
    const unique = Object.assign(new Error('duplicate key'), { code: '23505' });
    const result = await insertProjectMember(
      fakeClientSequence([{ rows: [{}] }, { rows: [{}] }, unique]),
      { orgId: 'org_1', projectId: 'prj_1', accountId: 'acc_1', role: 'developer' },
    );
    expect(result).toEqual({ status: 'already_member' });
  });
});
