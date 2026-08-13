import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import { createAlertRule, updateAlertRule } from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

const RULE_INPUT = {
  name: '错误数量过高',
  metric: 'error_count',
  filters: { environment: [], release: [], pageOrEndpoint: [], errorSeverity: [] },
  windowMinutes: 5,
  triggerThreshold: 100,
  triggerDurationMinutes: 2,
  recoveryThreshold: 60,
  cooldownMinutes: 10,
  recipientAccountIds: ['account_1'],
};

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: { status: 'succeeded', ruleId: 'rule_1' } });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('DAT-19 Alert rule Command client', () => {
  it('createAlertRule sends the full rule input with idempotency + csrf', async () => {
    await createAlertRule(SCOPE, RULE_INPUT, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    const call = lastCall();
    expect(call.operationId).toBe('alertsCreateRule');
    expect(call.scope).toEqual({ type: 'project', id: 'prj_1' });
    expect(call.csrf).toBe(CSRF);
    expect(call.input).toMatchObject({
      pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      body: {
        ...RULE_INPUT,
        idempotencyKey: FIXED_KEY,
      },
    });
  });

  it('updateAlertRule includes the optimistic version on the rule id', async () => {
    await updateAlertRule(
      SCOPE,
      'rule_1',
      RULE_INPUT,
      { version: 3 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    const call = lastCall();
    expect(call.operationId).toBe('alertsUpdateRule');
    expect(call.input).toMatchObject({
      pathParams: { organizationId: 'org_1', projectId: 'prj_1', ruleId: 'rule_1' },
      body: { ...RULE_INPUT, version: 3, idempotencyKey: FIXED_KEY },
    });
  });

  it('omits optional fields (name/recoveryDuration/minSampleCount) when absent', async () => {
    const { name: _name, ...withoutName } = RULE_INPUT;
    void _name;
    await createAlertRule(SCOPE, withoutName, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    const body = lastCall().input?.body as Record<string, unknown>;
    expect(body.name).toBeUndefined();
    expect(body.recoveryDurationMinutes).toBeUndefined();
    expect(body.minSampleCount).toBeUndefined();
  });
});
