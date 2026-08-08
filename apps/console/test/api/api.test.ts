import { http, HttpResponse, type JsonBodyType } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  validProblemSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';
import { requestCache } from '../../src/api/cache.js';
import { platformRequest } from '../../src/api/client.js';
import { queryKey } from '../../src/api/query-key.js';
import { executeQuery, invalidateQueryKey, invalidateScope } from '../../src/api/query.js';
import { scopeKeyString, type ScopeKey } from '../../src/api/scope.js';
import { handlerControls } from '../../src/mocks/handlers.js';
import { mockServer } from '../msw/server.js';

const workspace: ScopeKey = { type: 'workspace' };
const project: ScopeKey = { type: 'project', id: 'prj_test_1' };
const SESSION_KEY = 'workspace:identityGetSession';

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  requestCache.clear();
  handlerControls.delayMs = 0;
  handlerControls.sessionRequests = 0;
});
afterEach(() => {
  mockServer.resetHandlers();
});
afterAll(() => {
  mockServer.close();
});

describe('request/cache layer', () => {
  it('fetches a session through the generated client', async () => {
    const data = await executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
    });
    expect(data).toEqual(validSessionSamples[0]);
    expect(requestCache.get(SESSION_KEY)).toBeDefined();
  });

  it('deduplicates concurrent identical queries into one network call', async () => {
    const [a, b] = await Promise.all([
      executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} }),
      executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} }),
    ]);
    expect(a).toEqual(b);
    expect(handlerControls.sessionRequests).toBe(1);
  });

  it('cancels an in-flight request via AbortSignal', async () => {
    handlerControls.delayMs = 50;
    const controller = new AbortController();
    const promise = executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('discards a stale response after scope invalidation', async () => {
    handlerControls.delayMs = 50;
    const promise = executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
    });
    invalidateScope(workspace);
    await promise;
    expect(requestCache.get(SESSION_KEY)).toBeUndefined();
  });

  it('retries a retryable read once after a network error', async () => {
    let calls = 0;
    mockServer.use(
      http.get('/api/platform/v1/session', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.error();
        return HttpResponse.json(validSessionSamples[0] as JsonBodyType, { status: 200 });
      }),
    );
    const data = await executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: {},
    });
    expect(calls).toBe(2);
    expect(data).toBeDefined();
  });

  it('normalizes an RFC 9457 problem from the contract testkit', async () => {
    mockServer.use(
      http.get('/api/platform/v1/session', () =>
        HttpResponse.json(validProblemSamples[0] as JsonBodyType, { status: 404 }),
      ),
    );
    await expect(
      executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} }),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('invalidates only the matching scope', async () => {
    await executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} });
    await executeQuery({ operationId: 'identityGetSession', scope: project, input: {} });
    invalidateScope(workspace);
    expect(requestCache.get(SESSION_KEY)).toBeUndefined();
    expect(requestCache.get('project:prj_test_1:identityGetSession')).toBeDefined();
  });

  it('invalidates a single query key and forces a fresh fetch', async () => {
    await executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} });
    expect(requestCache.get(SESSION_KEY)).toBeDefined();
    invalidateQueryKey(SESSION_KEY);
    expect(requestCache.get(SESSION_KEY)).toBeUndefined();
    await executeQuery({ operationId: 'identityGetSession', scope: workspace, input: {} });
    expect(handlerControls.sessionRequests).toBe(2);
  });

  it('stringifies every scope kind for cache keys', () => {
    expect(scopeKeyString({ type: 'organization', id: 'org_test_1' })).toBe(
      'organization:org_test_1',
    );
    expect(scopeKeyString({ type: 'project', id: 'prj_test_1' })).toBe('project:prj_test_1');
    expect(scopeKeyString({ type: 'workspace' })).toBe('workspace');
  });

  it('appends a params suffix only when query params exist', () => {
    expect(queryKey({ type: 'project', id: 'prj_test_1' }, 'op', { projectId: 'p' })).toBe(
      'project:prj_test_1:op:{"projectId":"p"}',
    );
  });

  it('rejects an unknown operation id as a structural error', async () => {
    await expect(
      platformRequest('made.up.operation', {}, { scope: workspace }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'structural_error' });
  });

  it('maps a rejected request body to a structural error', async () => {
    await expect(
      platformRequest('identityGetSession', { body: { invalid: true } }, { scope: workspace }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'structural_error' });
  });

  it('passes an explicit empty query object through the request builder', async () => {
    const data = await executeQuery({
      operationId: 'identityGetSession',
      scope: workspace,
      input: { query: {} },
    });
    expect(data).toEqual(validSessionSamples[0]);
  });
});
