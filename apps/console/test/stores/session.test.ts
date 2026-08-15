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
  handlerControls.delayMs = 0;
  handlerControls.sessionVerified = true;
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

  it('does not re-fetch while already authenticated', async () => {
    const store = useSessionStore();
    await store.restore();
    expect(handlerControls.sessionRequests).toBe(1);
    await store.restore();
    expect(store.status).toBe('authenticated');
    expect(handlerControls.sessionRequests).toBe(1);
  });

  it('force-restores authoritative account state even while authenticated', async () => {
    const store = useSessionStore();
    await store.restore();
    expect(store.account?.verified).toBe(true);

    mockServer.use(
      http.get('/api/platform/v1/session', () => {
        handlerControls.sessionRequests += 1;
        return HttpResponse.json({
          account: {
            accountId: 'acct_history_1',
            email: 'history@tests.invalid',
            emailMasked: 'h***@tests.invalid',
            verified: false,
          },
          authentication: 'pending_verification',
          session: { expiresAt: '2026-08-15T01:00:00.000Z' },
          emailVerification: {
            serverTime: '2026-08-14T00:00:30.000Z',
            resendAvailableAt: '2026-08-14T00:01:00.000Z',
          },
          csrf: 'csrf_history_test',
          navigation: [],
        } as JsonBodyType);
      }),
    );
    await store.restore({ force: true });

    expect(handlerControls.sessionRequests).toBe(2);
    expect(store.account).toMatchObject({
      accountId: 'acct_history_1',
      emailMasked: 'h***@tests.invalid',
      verified: false,
    });
    expect(store.csrf).toBe('csrf_history_test');
    expect(store.emailVerification).toEqual({
      serverTime: '2026-08-14T00:00:30.000Z',
      resendAvailableAt: '2026-08-14T00:01:00.000Z',
    });
  });

  it('does not resurrect cleared session state when reset() runs during an in-flight restore', async () => {
    handlerControls.delayMs = 50;
    try {
      const store = useSessionStore();
      const pending = store.restore();
      expect(store.status).toBe('loading');
      store.reset();
      expect(store.status).toBe('idle');
      await pending;
      expect(store.status).toBe('idle');
      expect(store.account).toBeNull();
    } finally {
      handlerControls.delayMs = 0;
    }
    // a fresh restore after the stale in-flight restore is discarded still works
    const store = useSessionStore();
    await store.restore();
    expect(store.status).toBe('authenticated');
    expect(store.account?.accountId).toBe('acct_test_1');
  });
});
