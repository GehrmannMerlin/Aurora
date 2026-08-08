import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { validProblemSamples } from '@aurora/platform-contract/contract-testkit';
import { ApiError } from '../../src/api/errors.js';
import { handlerControls } from '../../src/mocks/handlers.js';
import { invalidateScope } from '../../src/api/query.js';
import { mapSessionError, useSessionStore } from '../../src/stores/session.js';
import { mockServer } from '../msw/server.js';

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  setActivePinia(createPinia());
  mockServer.resetHandlers();
  handlerControls.sessionRequests = 0;
});
afterEach(() => {
  invalidateScope({ type: 'account' });
});
afterAll(() => {
  mockServer.close();
});

describe('Session Context consumer', () => {
  it('enters authenticated with the contract-projected account (no fabricated data)', async () => {
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('authenticated');
    expect(store.account?.accountId).toBe('acct_test_1');
    expect(store.account?.email).toBe('user@example.invalid');
  });

  it('enters unavailable on a network failure and never fabricates authenticated', async () => {
    mockServer.use(http.get('/api/platform/v1/session', () => HttpResponse.error()));
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('unavailable');
    expect(store.account).toBeNull();
  });

  it('enters unavailable on a contract 404 problem (safe non-committal state)', async () => {
    mockServer.use(
      http.get('/api/platform/v1/session', () =>
        HttpResponse.json(validProblemSamples[0] as JsonBodyType, { status: 404 }),
      ),
    );
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('unavailable');
    expect(store.account).toBeNull();
  });

  it('maps an authentication problem to unauthenticated', () => {
    expect(mapSessionError(new ApiError({ code: 'authentication', message: 'No session' }))).toBe(
      'unauthenticated',
    );
    expect(mapSessionError(new ApiError({ code: 'authority_unavailable', message: 'x' }))).toBe(
      'unavailable',
    );
    expect(mapSessionError(new ApiError({ code: 'network_error', message: 'x' }))).toBe(
      'unavailable',
    );
  });

  it('reset clears session memory and invalidates the cached session', async () => {
    const store = useSessionStore();
    await store.restore();
    expect(handlerControls.sessionRequests).toBe(1);
    store.reset();
    expect(store.status).toBe('idle');
    expect(store.account).toBeNull();
    await store.restore();
    expect(handlerControls.sessionRequests).toBe(2);
  });
});
