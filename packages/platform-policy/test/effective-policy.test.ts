import { describe, expect, it } from 'vitest';
import { computeEffectivePolicy } from '../src/effective-policy.js';
import type {
  OrganizationOverride,
  PlatformDefaultPolicy,
  ProjectLimit,
} from '../src/policy-types.js';

function makeDefaultPolicy(
  overrides: Partial<PlatformDefaultPolicy> = {},
): PlatformDefaultPolicy {
  return {
    defaultPeriodQuota: 1_000_000,
    warningRatio: 80,
    hardLimit: 100,
    degradationEnabled: true,
    highValueRetentionDays: 90,
    policySource: 'system_default',
    version: 1,
    updatedAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeOrgOverride(overrides: Partial<OrganizationOverride> = {}): OrganizationOverride {
  return {
    organizationId: '00000000-0000-4000-8000-000000000010',
    defaultPeriodQuota: 500_000,
    warningRatio: 70,
    hardLimit: 90,
    degradationEnabled: false,
    highValueRetentionDays: 45,
    policySource: 'platform_admin',
    version: 2,
    updatedAt: '2026-08-12T01:00:00.000Z',
    ...overrides,
  };
}

function makeProjectLimit(overrides: Partial<ProjectLimit> = {}): ProjectLimit {
  return {
    projectId: '00000000-0000-4000-8000-000000000020',
    resourceLimit: 50_000,
    policySource: 'platform_admin',
    version: 1,
    updatedAt: '2026-08-12T02:00:00.000Z',
    ...overrides,
  };
}

describe('computeEffectivePolicy (pure)', () => {
  it('returns null when no platform default policy is configured', () => {
    expect(
      computeEffectivePolicy({ defaultPolicy: null, orgOverride: null, projectLimit: null }),
    ).toBeNull();
    expect(
      computeEffectivePolicy({
        defaultPolicy: null,
        orgOverride: makeOrgOverride(),
        projectLimit: makeProjectLimit(),
      }),
    ).toBeNull();
  });

  it('inherits the platform default when there is no organization override', () => {
    const result = computeEffectivePolicy({
      defaultPolicy: makeDefaultPolicy(),
      orgOverride: null,
      projectLimit: null,
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe('system_default');
    expect(result?.configured).toEqual({
      defaultPeriodQuota: 1_000_000,
      warningRatio: 80,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 90,
    });
    expect(result?.effective).toEqual({
      defaultPeriodQuota: 1_000_000,
      warningRatio: 80,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 90,
    });
  });

  it('uses the organization override entirely when present (source platform_admin)', () => {
    const result = computeEffectivePolicy({
      defaultPolicy: makeDefaultPolicy(),
      orgOverride: makeOrgOverride(),
      projectLimit: null,
    });

    expect(result?.source).toBe('platform_admin');
    expect(result?.configured).toEqual({
      defaultPeriodQuota: 500_000,
      warningRatio: 70,
      hardLimit: 90,
      degradationEnabled: false,
      highValueRetentionDays: 45,
    });
    expect(result?.effective).toEqual({
      defaultPeriodQuota: 500_000,
      warningRatio: 70,
      hardLimit: 90,
      degradationEnabled: false,
      highValueRetentionDays: 45,
    });
  });

  it('overrides resource_limit from the project limit and inherits the remaining fields', () => {
    const result = computeEffectivePolicy({
      defaultPolicy: makeDefaultPolicy(),
      orgOverride: makeOrgOverride(),
      projectLimit: makeProjectLimit(),
    });

    expect(result?.source).toBe('platform_admin');
    expect(result?.effective).toEqual({
      defaultPeriodQuota: 500_000,
      warningRatio: 70,
      hardLimit: 90,
      degradationEnabled: false,
      highValueRetentionDays: 45,
      resourceLimit: 50_000,
    });
    expect(result?.configured.resourceLimit).toBe(50_000);
  });

  it('inherits the platform default for the remaining fields when only a project limit exists', () => {
    const result = computeEffectivePolicy({
      defaultPolicy: makeDefaultPolicy(),
      orgOverride: null,
      projectLimit: makeProjectLimit(),
    });

    expect(result?.source).toBe('system_default');
    expect(result?.effective).toEqual({
      defaultPeriodQuota: 1_000_000,
      warningRatio: 80,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 90,
      resourceLimit: 50_000,
    });
  });
});
