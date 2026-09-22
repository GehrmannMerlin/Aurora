import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { getOnboarding } from '../src/repositories/onboarding.js';
import {
  changeProjectMemberRole,
  listProjectEffectiveMembers,
  removeProjectMember,
} from '../src/repositories/access.js';
import { restoreFromArchive } from '../src/repositories/lifecycle.js';
import {
  getProjectAccessRole,
  getProjectById,
  insertProjectMember,
  updateProjectStatus,
} from '../src/repositories/projects.js';
import {
  createProjectEnvironment,
  listProjectEnvironments,
  updateProjectSettings,
} from '../src/repositories/settings.js';

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
      if (response === undefined) {
        throw new Error('fakeClientSequence exhausted: no more queued responses');
      }
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

describe('effective project access repositories (fake client)', () => {
  it('projects the org-manager and explicit-member sources', async () => {
    const result = await listProjectEffectiveMembers(
      fakeClient([
        {
          account_id: 'acc_admin',
          email: 'admin@example.com',
          org_role: 'admin',
          project_role: null,
        },
        {
          account_id: 'acc_dev',
          email: 'dev@example.com',
          org_role: 'member',
          project_role: 'developer',
        },
      ]),
      { orgId: 'org_1', projectId: 'prj_1' },
    );
    expect(result).toEqual([
      {
        accountId: 'acc_admin',
        email: 'admin@example.com',
        effectiveRole: 'project_admin',
        sources: ['org_inherited'],
      },
      {
        accountId: 'acc_dev',
        email: 'dev@example.com',
        effectiveRole: 'developer',
        sources: ['project_member'],
        projectRole: 'developer',
      },
    ]);
  });

  it('changes an explicit role and records the audit event', async () => {
    const result = await changeProjectMemberRole(
      fakeClientSequence([{ rows: [{ account_id: 'acc_1' }] }, { rows: [] }]),
      {
        orgId: 'org_1',
        projectId: 'prj_1',
        accountId: 'acc_1',
        role: 'read_only',
        actorId: 'actor_1',
      },
    );
    expect(result).toEqual({ status: 'success', accountId: 'acc_1', role: 'read_only' });
  });

  it('returns not_found and rejects invalid roles', async () => {
    await expect(
      changeProjectMemberRole(fakeClient([]), {
        orgId: 'org_1',
        projectId: 'prj_1',
        accountId: 'acc_1',
        role: 'invalid' as never,
        actorId: 'actor_1',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      changeProjectMemberRole(fakeClient([]), {
        orgId: 'org_1',
        projectId: 'prj_1',
        accountId: 'acc_1',
        role: 'developer',
        actorId: 'actor_1',
      }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('removes a member and reports remaining org inheritance', async () => {
    const inherited = await removeProjectMember(
      fakeClientSequence([
        { rows: [{ account_id: 'acc_1' }] },
        { rows: [{ org_inherited: true }] },
        { rows: [] },
      ]),
      {
        orgId: 'org_1',
        projectId: 'prj_1',
        accountId: 'acc_1',
        actorId: 'actor_1',
      },
    );
    expect(inherited).toEqual({
      status: 'success',
      accountId: 'acc_1',
      remainingSources: ['org_inherited'],
    });

    const noInheritance = await removeProjectMember(
      fakeClientSequence([
        { rows: [{ account_id: 'acc_2' }] },
        { rows: [{ org_inherited: false }] },
        { rows: [] },
      ]),
      {
        orgId: 'org_1',
        projectId: 'prj_1',
        accountId: 'acc_2',
        actorId: 'actor_1',
      },
    );
    expect(noInheritance).toEqual({ status: 'success', accountId: 'acc_2', remainingSources: [] });
    await expect(
      removeProjectMember(fakeClient([]), {
        orgId: 'org_1',
        projectId: 'prj_1',
        accountId: 'missing',
        actorId: 'actor_1',
      }),
    ).resolves.toEqual({ status: 'not_found' });
  });
});

describe('project lifecycle and settings repositories (fake client)', () => {
  const lifecycleInput = {
    orgId: 'org_1',
    projectId: 'prj_1',
    expectedVersion: '2026-09-22T00:00:00.000Z',
    actorId: 'actor_1',
  };

  it('restores only archived projects with a matching resource version', async () => {
    await expect(restoreFromArchive(fakeClient([]), lifecycleInput)).resolves.toEqual({
      status: 'not_found',
    });
    await expect(
      restoreFromArchive(
        fakeClient([{ status: 'archived', updated_at: '2026-09-22T00:00:01.000Z' }]),
        lifecycleInput,
      ),
    ).resolves.toEqual({
      status: 'version_conflict',
      currentResourceVersion: '2026-09-22T00:00:01.000Z',
    });
    await expect(
      restoreFromArchive(
        fakeClient([{ status: 'active', updated_at: lifecycleInput.expectedVersion }]),
        lifecycleInput,
      ),
    ).resolves.toEqual({ status: 'state_machine_conflict', currentStatus: 'active' });
    await expect(
      restoreFromArchive(
        fakeClientSequence([
          { rows: [{ status: 'archived', updated_at: lifecycleInput.expectedVersion }] },
          { rows: [] },
          { rows: [] },
        ]),
        lifecycleInput,
      ),
    ).resolves.toEqual({ status: 'success', projectId: 'prj_1', projectStatus: 'active' });
  });

  const settingsInput = {
    orgId: 'org_1',
    projectId: 'prj_1',
    name: '  Updated project  ',
    websiteUrl: '  https://example.com  ',
    expectedVersion: '2026-09-22T00:00:00.000Z',
    actorId: 'actor_1',
  };

  it('validates and updates project settings with optimistic concurrency', async () => {
    await expect(
      updateProjectSettings(fakeClient([]), { ...settingsInput, name: 'x' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(updateProjectSettings(fakeClient([]), settingsInput)).resolves.toEqual({
      status: 'not_found',
    });
    await expect(
      updateProjectSettings(
        fakeClient([{ status: 'active', updated_at: '2026-09-22T00:00:01.000Z' }]),
        settingsInput,
      ),
    ).resolves.toEqual({
      status: 'version_conflict',
      currentResourceVersion: '2026-09-22T00:00:01.000Z',
    });
    await expect(
      updateProjectSettings(
        fakeClient([{ status: 'archived', updated_at: settingsInput.expectedVersion }]),
        settingsInput,
      ),
    ).resolves.toEqual({ status: 'state_machine_conflict', currentStatus: 'archived' });
    await expect(
      updateProjectSettings(
        fakeClientSequence([
          { rows: [{ status: 'active', updated_at: settingsInput.expectedVersion }] },
          { rows: [{ updated_at: new Date('2026-09-22T00:00:02.000Z') }] },
          { rows: [] },
        ]),
        settingsInput,
      ),
    ).resolves.toEqual({
      status: 'success',
      projectId: 'prj_1',
      name: 'Updated project',
      websiteUrl: 'https://example.com',
      resourceVersion: '2026-09-22T00:00:02.000Z',
    });
  });

  it('lists environments and handles environment creation outcomes', async () => {
    await expect(
      listProjectEnvironments(
        fakeClient([
          {
            environment_id: 'env_1',
            project_id: 'prj_1',
            name: 'production',
            is_default: true,
            created_at: new Date('2026-09-22T00:00:00.000Z'),
          },
        ]),
        { orgId: 'org_1', projectId: 'prj_1' },
      ),
    ).resolves.toEqual([
      {
        environmentId: 'env_1',
        projectId: 'prj_1',
        name: 'production',
        isDefault: true,
        createdAt: '2026-09-22T00:00:00.000Z',
      },
    ]);
    await expect(
      createProjectEnvironment(fakeClient([]), {
        orgId: 'org_1',
        projectId: 'prj_1',
        name: '',
        actorId: 'actor_1',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      createProjectEnvironment(fakeClient([]), {
        orgId: 'org_1',
        projectId: 'prj_1',
        name: 'staging',
        actorId: 'actor_1',
      }),
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      createProjectEnvironment(
        fakeClientSequence([{ rows: [{}] }, { rows: [{ environment_id: 'env_2' }] }, { rows: [] }]),
        { orgId: 'org_1', projectId: 'prj_1', name: ' staging ', actorId: 'actor_1' },
      ),
    ).resolves.toEqual({ status: 'success', environmentId: 'env_2', name: 'staging' });
    const unique = Object.assign(new Error('duplicate'), { code: '23505' });
    await expect(
      createProjectEnvironment(fakeClientSequence([{ rows: [{}] }, unique]), {
        orgId: 'org_1',
        projectId: 'prj_1',
        name: 'staging',
        actorId: 'actor_1',
      }),
    ).resolves.toEqual({ status: 'duplicate' });
  });
});
