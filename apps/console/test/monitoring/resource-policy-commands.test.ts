import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  clearPolicyProjectLimit,
  resetPolicyOrganization,
  setPolicyDefault,
  setPolicyOrganization,
  setPolicyProjectLimit,
} from '../../src/monitoring/commands.js';
import {
  fetchPlatformAdminCapability,
  fetchPolicyGetDefault,
  fetchPolicyGetOrganizationEffective,
  fetchPolicyGetProjectEffective,
  fetchPolicyTargetSearch,
  type PlatformPolicyProjection,
  type ProjectPolicyProjection,
} from '../../src/monitoring/queries.js';

const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

const FIVE_FIELDS = {
  defaultPeriodQuota: 1_000_000,
  warningRatio: 80,
  hardLimit: 100,
  degradationEnabled: true,
  highValueRetentionDays: 90,
} as const;

const DEFAULT_PROJECTION: PlatformPolicyProjection = {
  configured: { ...FIVE_FIELDS },
  source: 'system_default',
  effective: { ...FIVE_FIELDS },
  version: 1,
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

const PROJECT_PROJECTION: ProjectPolicyProjection = {
  configured: { resourceLimit: 50_000 },
  source: 'platform_admin',
  effective: { ...FIVE_FIELDS, resourceLimit: 50_000 },
  version: 1,
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
};

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: { status: 'set', version: 2 } });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

function lastInput() {
  const call = lastCall();
  if (call.input === undefined) throw new Error('executeQuery input was not provided');
  return call.input;
}

function queryEnvelope<T>(data: T) {
  return {
    data,
    meta: { requestId: 'req_1', readAt: '2026-08-12T12:00:00.000Z' },
    allowedActions: ['read'],
    navigationTargets: [],
  };
}

describe('PLT-10c resource-policy Command client', () => {
  it('setPolicyDefault targets policySetDefault with five fields + version + idempotencyKey', async () => {
    const result = await setPolicyDefault(
      { ...FIVE_FIELDS, version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(result).toEqual({ status: 'set', version: 2 });
    const call = lastCall();
    expect(call.operationId).toBe('policySetDefault');
    expect(lastInput().pathParams).toBeUndefined();
    expect(lastInput().body).toEqual({ ...FIVE_FIELDS, version: 1, idempotencyKey: FIXED_KEY });
    expect(call.scope).toEqual({ type: 'account' });
    expect(call.csrf).toBe(CSRF);
  });

  it('setPolicyOrganization targets policySetOrganization with the organization path param', async () => {
    const result = await setPolicyOrganization(
      'org_1',
      { ...FIVE_FIELDS, version: 0 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(result).toEqual({ status: 'set', version: 2 });
    const call = lastCall();
    expect(call.operationId).toBe('policySetOrganization');
    expect(lastInput().pathParams).toEqual({ organizationId: 'org_1' });
    expect(lastInput().body).toEqual({ ...FIVE_FIELDS, version: 0, idempotencyKey: FIXED_KEY });
    expect(call.scope).toEqual({ type: 'account' });
  });

  it('resetPolicyOrganization targets policyResetOrganization with confirm:true', async () => {
    mockedExecuteQuery.mockResolvedValue({ data: { status: 'reset' } });
    const result = await resetPolicyOrganization(
      'org_1',
      { version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(result).toEqual({ status: 'reset' });
    const call = lastCall();
    expect(call.operationId).toBe('policyResetOrganization');
    expect(lastInput().pathParams).toEqual({ organizationId: 'org_1' });
    expect(lastInput().body).toEqual({ version: 1, confirm: true, idempotencyKey: FIXED_KEY });
    expect(call.scope).toEqual({ type: 'account' });
    expect(call.csrf).toBe(CSRF);
  });

  it('setPolicyProjectLimit targets policySetProjectLimit with resourceLimit + version', async () => {
    const result = await setPolicyProjectLimit(
      'proj_1',
      { resourceLimit: 50_000, version: 0 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(result).toEqual({ status: 'set', version: 2 });
    const call = lastCall();
    expect(call.operationId).toBe('policySetProjectLimit');
    expect(lastInput().pathParams).toEqual({ projectId: 'proj_1' });
    expect(lastInput().body).toEqual({
      resourceLimit: 50_000,
      version: 0,
      idempotencyKey: FIXED_KEY,
    });
    expect(call.scope).toEqual({ type: 'account' });
  });

  it('clearPolicyProjectLimit targets policyClearProjectLimit with confirm:true', async () => {
    mockedExecuteQuery.mockResolvedValue({ data: { status: 'cleared' } });
    const result = await clearPolicyProjectLimit(
      'proj_1',
      { version: 1 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(result).toEqual({ status: 'cleared' });
    const call = lastCall();
    expect(call.operationId).toBe('policyClearProjectLimit');
    expect(lastInput().pathParams).toEqual({ projectId: 'proj_1' });
    expect(lastInput().body).toEqual({ version: 1, confirm: true, idempotencyKey: FIXED_KEY });
    expect(call.scope).toEqual({ type: 'account' });
    expect(call.csrf).toBe(CSRF);
  });
});

describe('PLT-10c resource-policy Query client', () => {
  it('fetchPlatformAdminCapability returns hasCapability from the plain data envelope', async () => {
    mockedExecuteQuery.mockResolvedValue({ data: { hasCapability: true } });
    const result = await fetchPlatformAdminCapability();
    expect(result).toEqual({ hasCapability: true });
    const call = lastCall();
    expect(call.operationId).toBe('platformAdminGetCapability');
    expect(call.scope).toEqual({ type: 'account' });
  });

  it('fetchPolicyTargetSearch passes q/limit query and returns the search result', async () => {
    const searchResult = {
      organizations: [{ organizationId: 'org_1', name: 'Acme' }],
      projects: [{ projectId: 'proj_1', organizationId: 'org_1', name: 'Acme Web' }],
      pagination: { totalCount: 2, totalCountStatus: 'available' },
    };
    mockedExecuteQuery.mockResolvedValue(queryEnvelope(searchResult));
    const result = await fetchPolicyTargetSearch({ q: 'acme', limit: 10 });
    expect(result).toEqual(searchResult);
    const call = lastCall();
    expect(call.operationId).toBe('policyTargetSearch');
    expect(lastInput().query).toEqual({ q: 'acme', limit: 10 });
    expect(call.scope).toEqual({ type: 'account' });
  });

  it('fetchPolicyGetDefault unwraps the nested data projection (account scope)', async () => {
    mockedExecuteQuery.mockResolvedValue(queryEnvelope({ data: DEFAULT_PROJECTION }));
    const result = await fetchPolicyGetDefault();
    expect(result).toEqual(DEFAULT_PROJECTION);
    const call = lastCall();
    expect(call.operationId).toBe('policyGetDefault');
    expect(lastInput().pathParams).toBeUndefined();
    expect(call.scope).toEqual({ type: 'account' });
  });

  it('fetchPolicyGetOrganizationEffective passes the org path param and unwraps the projection', async () => {
    mockedExecuteQuery.mockResolvedValue(queryEnvelope({ data: DEFAULT_PROJECTION }));
    const result = await fetchPolicyGetOrganizationEffective('org_1');
    expect(result).toEqual(DEFAULT_PROJECTION);
    const call = lastCall();
    expect(call.operationId).toBe('policyGetOrganizationEffective');
    expect(lastInput().pathParams).toEqual({ organizationId: 'org_1' });
    expect(call.scope).toEqual({ type: 'account' });
  });

  it('fetchPolicyGetProjectEffective passes the project path param and returns the project projection', async () => {
    mockedExecuteQuery.mockResolvedValue(queryEnvelope({ data: PROJECT_PROJECTION }));
    const result = await fetchPolicyGetProjectEffective('proj_1');
    expect(result).toEqual(PROJECT_PROJECTION);
    const call = lastCall();
    expect(call.operationId).toBe('policyGetProjectEffective');
    expect(lastInput().pathParams).toEqual({ projectId: 'proj_1' });
    expect(call.scope).toEqual({ type: 'account' });
  });
});
