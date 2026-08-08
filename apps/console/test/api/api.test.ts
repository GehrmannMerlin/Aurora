import { http, HttpResponse, type JsonBodyType } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  validProblemSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';
import { requestCache } from '../../src/api/cache.js';
import { invalidateScope, executeQuery } from '../../src/api/query.js';
import type { ScopeKey } from '../../src/api/scope.js';
import { handlerControls } from '../../src/mocks/handlers.js';
import { mockServer } from '../msw/server.js';

const workspace: ScopeKey = { type: 'workspace' };
const project: ScopeKey = { type: 'project', id: 'prj_test_1' };
const SESSION_KEY = 'workspace:identityGetSession';

beforeAll(() => mockServer.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  requestCache.clear();
  handlerControls.delayMs = 0;
  handlerControls.sessionRequests = 0;
});
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());

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
});
