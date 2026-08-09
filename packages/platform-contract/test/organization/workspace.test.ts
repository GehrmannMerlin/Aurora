import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LIST_PROJECTS,
  organizationListProjectsRequest,
  organizationListProjectsResponse,
} from '../../src/organization/workspace.js';

const validResponse = {
  projects: [
    {
      projectId: 'prj_123',
      name: 'Web',
      frameworkType: 'vue',
      status: 'active',
      lifecycle: 'active',
    },
  ],
  allowedActions: ['create'],
  navigationTargets: [],
};

describe('organizationListProjects contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_LIST_PROJECTS).toBe('organizationListProjects');
  });

  it('accepts a valid workspace request', () => {
    expect(organizationListProjectsRequest.zod.safeParse({ organizationId: 'org_1' }).success).toBe(
      true,
    );
  });

  it('rejects a missing organizationId', () => {
    expect(organizationListProjectsRequest.zod.safeParse({}).success).toBe(false);
  });

  it('rejects an undeclared request field (closed object)', () => {
    expect(
      organizationListProjectsRequest.zod.safeParse({ organizationId: 'org_1', projectId: 'p' })
        .success,
    ).toBe(false);
  });

  it('accepts a valid workspace response', () => {
    expect(organizationListProjectsResponse.zod.safeParse(validResponse).success).toBe(true);
  });

  it('rejects an unknown response field (closed object)', () => {
    expect(
      organizationListProjectsResponse.zod.safeParse({ ...validResponse, clientKeys: [] }).success,
    ).toBe(false);
  });

  it('rejects a leaked client-key plaintext', () => {
    const r = organizationListProjectsResponse.zod.safeParse({
      projects: [
        {
          projectId: 'p',
          name: 'x',
          frameworkType: 'js',
          status: 'active',
          lifecycle: 'active',
          clientKeyPlaintext: 'aurora_key_secret',
        },
      ],
      allowedActions: [],
      navigationTargets: [],
    });
    expect(r.success).toBe(false);
  });
});
