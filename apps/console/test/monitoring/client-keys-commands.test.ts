import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  createClientKey,
  disableClientKey,
  enableClientKey,
  revokeClientKey,
} from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({
    data: {
      status: 'created',
      credentialId: 'cred_1',
      keyId: 'ck_abcdefgh',
      clientKey: 'aurora_ingest_x',
      origins: [],
      environments: [],
    },
  });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('C14 client-key Command client', () => {
  it('create passes origins/environments/allowNonBrowser and returns the one-time clientKey', async () => {
    const result = await createClientKey(
      SCOPE,
      {
        origins: ['https://app.example.invalid'],
        environments: ['production'],
        allowNonBrowser: false,
      },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    expect(result.clientKey).toBe('aurora_ingest_x');
    const call = lastCall();
    expect(call.operationId).toBe('credentialsCreateClientKey');
    expect(call.input?.body).toMatchObject({
      origins: ['https://app.example.invalid'],
      environments: ['production'],
      allowNonBrowser: false,
      idempotencyKey: FIXED_KEY,
    });
  });

  it('disable/enable/revoke target the keyId path param', async () => {
    await disableClientKey(SCOPE, 'ck_abcdefgh', { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('credentialsDisableClientKey');
    expect(lastCall().input?.pathParams).toMatchObject({ keyId: 'ck_abcdefgh' });

    await enableClientKey(SCOPE, 'ck_abcdefgh', { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('credentialsEnableClientKey');

    await revokeClientKey(SCOPE, 'ck_abcdefgh', { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('credentialsRevokeClientKey');
  });
});
