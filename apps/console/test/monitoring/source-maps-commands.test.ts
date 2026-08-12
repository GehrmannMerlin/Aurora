import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeQuery } from '../../src/api/query.js';

vi.mock('../../src/api/query.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, executeQuery: vi.fn() };
});

const mockedExecuteQuery = vi.mocked(executeQuery);

import {
  reparseRelease,
  replaceSourceMap,
  uploadSourceMap,
} from '../../src/monitoring/commands.js';

const SCOPE = { organizationId: 'org_1', projectId: 'prj_1' };
const CSRF = 'csrf-token-123';
const FIXED_KEY = 'k12345678';

beforeEach(() => {
  mockedExecuteQuery.mockReset();
  mockedExecuteQuery.mockResolvedValue({ data: { status: 'uploaded' } });
});

function lastCall() {
  const calls = mockedExecuteQuery.mock.calls;
  const call = calls[calls.length - 1]?.[0];
  if (call === undefined) throw new Error('executeQuery was not called');
  return call;
}

describe('DAT-18 Source Map Command client', () => {
  it('uploadSourceMap sends the upload operation with release/path/content/digest + idempotency + csrf', async () => {
    await uploadSourceMap(
      SCOPE,
      {
        releaseVersion: 'shop-web@1.4.3',
        buildPath: '/assets/app.js',
        content: '{"version":3,"sources":[]}',
        digest: 'a'.repeat(64),
        buildId: 'build-9',
      },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    const call = lastCall();
    expect(call.operationId).toBe('sourceMapsUpload');
    expect(call.scope).toEqual({ type: 'project', id: 'prj_1' });
    expect(call.csrf).toBe(CSRF);
    expect(call.input).toMatchObject({
      pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
      body: {
        releaseVersion: 'shop-web@1.4.3',
        buildPath: '/assets/app.js',
        content: '{"version":3,"sources":[]}',
        digest: 'a'.repeat(64),
        buildId: 'build-9',
        idempotencyKey: FIXED_KEY,
      },
    });
  });

  it('uploadSourceMap omits optional buildId when absent', async () => {
    await uploadSourceMap(
      SCOPE,
      {
        releaseVersion: 'v1',
        buildPath: '/app.js',
        content: '{}',
        digest: 'b'.repeat(64),
      },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    const body = lastCall().input?.body as Record<string, unknown>;
    expect(body.buildId).toBeUndefined();
  });

  it('replaceSourceMap sends the versioned replace on the file id', async () => {
    await replaceSourceMap(
      SCOPE,
      'release_1',
      'sm_1',
      { content: '{}', digest: 'c'.repeat(64), version: 3 },
      { csrf: CSRF, idempotencyKey: FIXED_KEY },
    );
    const call = lastCall();
    expect(call.operationId).toBe('sourceMapsReplace');
    expect(call.input).toMatchObject({
      pathParams: {
        organizationId: 'org_1',
        projectId: 'prj_1',
        releaseId: 'release_1',
        sourceMapFileId: 'sm_1',
      },
      body: { content: '{}', digest: 'c'.repeat(64), version: 3, idempotencyKey: FIXED_KEY },
    });
  });

  it('reparseRelease sends the reparse operation scoped to the release', async () => {
    await reparseRelease(SCOPE, 'release_1', { csrf: CSRF, idempotencyKey: FIXED_KEY });
    const call = lastCall();
    expect(call.operationId).toBe('sourceMapsReparse');
    expect(call.input).toMatchObject({
      pathParams: {
        organizationId: 'org_1',
        projectId: 'prj_1',
        releaseId: 'release_1',
      },
      body: { idempotencyKey: FIXED_KEY },
    });
  });
});
