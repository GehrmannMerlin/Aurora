import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import { markNotificationRead } from '../../src/monitoring/commands.js';

const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({
    data: { status: 'read', notificationId: 'notif_1' },
  });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('PLT-09 notification Command client', () => {
  it('mark-read targets notificationsMarkRead with the notificationId path param', async () => {
    const result = await markNotificationRead('notif_1', {
      csrf: CSRF,
      idempotencyKey: FIXED_KEY,
    });
    expect(result).toEqual({ status: 'read', notificationId: 'notif_1' });
    const call = lastCall();
    expect(call.operationId).toBe('notificationsMarkRead');
    expect(call.input!.pathParams).toEqual({ notificationId: 'notif_1' });
    expect(call.input!.body).toEqual({ idempotencyKey: FIXED_KEY });
    expect(call.scope).toEqual({ type: 'account' });
    expect(call.csrf).toBe(CSRF);
  });
});
