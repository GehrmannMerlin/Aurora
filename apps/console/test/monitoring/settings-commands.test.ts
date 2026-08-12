import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  createProjectEnvironment,
  updateProjectSettings,
} from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: { status: 'updated' } });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('C15 settings Command client', () => {
  it('update sends name + resourceVersion (+ optional websiteUrl) + idempotency + csrf', async () => {
    await updateProjectSettings(
      SCOPE,
      { name: 'Web shop', websiteUrl: 'https://example.invalid', resourceVersion: '1' },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    const call = lastCall();
    expect(call.operationId).toBe('settingsUpdateProject');
    expect(call.csrf).toBe(CSRF);
    expect(call.input!.body).toMatchObject({
      name: 'Web shop',
      websiteUrl: 'https://example.invalid',
      resourceVersion: '1',
      idempotencyKey: FIXED_KEY,
    });
  });

  it('create-environment sends the name', async () => {
    await createProjectEnvironment(SCOPE, { name: 'staging' }, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    const call = lastCall();
    expect(call.operationId).toBe('settingsCreateEnvironment');
    expect(call.input!.body).toMatchObject({ name: 'staging', idempotencyKey: FIXED_KEY });
  });
});
