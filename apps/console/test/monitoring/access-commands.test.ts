import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  changeProjectRole,
  grantProjectMembership,
  removeProjectMembership,
} from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: { status: 'granted' } });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('C13 project access Command client', () => {
  it('grant sends accountId + role + idempotency + csrf', async () => {
    await grantProjectMembership(SCOPE, { accountId: 'acc_1', role: 'developer' }, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    const call = lastCall();
    expect(call.operationId).toBe('accessGrantProjectMembership');
    expect(call.csrf).toBe(CSRF);
    expect(call.input!).toMatchObject({
      pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      body: { accountId: 'acc_1', role: 'developer', idempotencyKey: FIXED_KEY },
    });
  });

  it('change-role and remove target the account path param', async () => {
    await changeProjectRole(SCOPE, 'acc_1', { role: 'project_admin' }, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('accessChangeProjectRole');
    expect(lastCall().input!.pathParams).toMatchObject({ accountId: 'acc_1' });

    await removeProjectMembership(SCOPE, 'acc_1', { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('accessRemoveProjectMembership');
    expect(lastCall().input!.pathParams).toMatchObject({ accountId: 'acc_1' });
  });
});
