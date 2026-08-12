import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  archiveProject,
  moveProjectToTrash,
  restoreProjectFromArchive,
} from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: { status: 'archived' } });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('C16 lifecycle Command client', () => {
  it('archive / restore-from-archive send only an idempotency key', async () => {
    await archiveProject(SCOPE, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('lifecycleArchiveProject');

    await restoreProjectFromArchive(SCOPE, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    expect(lastCall().operationId).toBe('lifecycleRestoreProject');
  });

  it('move-to-trash carries the optimistic resourceVersion', async () => {
    await moveProjectToTrash(SCOPE, { resourceVersion: '1' }, { csrf: CSRF, idempotencyKey: FIXED_KEY });
    const call = lastCall();
    expect(call.operationId).toBe('lifecycleMoveToTrash');
    expect(call.input!.body).toMatchObject({ resourceVersion: '1', idempotencyKey: FIXED_KEY });
  });
});
