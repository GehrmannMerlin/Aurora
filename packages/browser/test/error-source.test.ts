import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment } from '../src/index.js';

interface Registration {
  readonly type: string;
  readonly listener: (event: unknown) => void;
  readonly capture: boolean;
}
function createTarget(
  options: { readonly throwOnAdd?: string; readonly shouldThrowOnRemove?: boolean } = {},
) {
  const registrations: Registration[] = [];
  return {
    registrations,
    addEventListener(type: string, listener: (event: unknown) => void, capture = false): void {
      if (type === options.throwOnAdd) throw new Error('token=registration-secret');
      registrations.push({ type, listener, capture });
    },
    removeEventListener(type: string, listener: (event: unknown) => void, capture = false): void {
      if (options.shouldThrowOnRemove === true) throw new Error('token=removal-secret');
      const index = registrations.findIndex(
        (item) => item.type === type && item.listener === listener && item.capture === capture,
      );
      if (index >= 0) registrations.splice(index, 1);
    },
    dispatch(type: string, event: unknown): void {
      for (const item of [...registrations]) if (item.type === type) item.listener(event);
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('Browser error source subscription', () => {
  it('registers exact listeners and cancels idempotently', () => {
    const target = createTarget();
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    const events: unknown[] = [];
    const result = browser.subscribeErrorSources((event) => events.push(event));
    expect(result).toMatchObject({ ok: true, code: 'subscribed', diagnosticsAdded: 0 });
    expect(target.registrations.map(({ type, capture }) => ({ type, capture }))).toEqual([
      { type: 'error', capture: true },
      { type: 'unhandledrejection', capture: false },
    ]);
    target.dispatch('error', { target: window, message: 'Synthetic', error: new Error('x') });
    expect(events).toHaveLength(1);
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe().code).toBe('unsubscribed');
    expect(result.subscription.unsubscribe().code).toBe('already_unsubscribed');
    expect(target.registrations).toEqual([]);
  });

  it('rolls back error when unhandledrejection registration fails', () => {
    const target = createTarget({ throwOnAdd: 'unhandledrejection' });
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    expect(browser.subscribeErrorSources(() => undefined)).toMatchObject({
      ok: false,
      code: 'listener_registration_failed',
    });
    expect(target.registrations).toEqual([]);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('secret');
  });

  it('logically disables a subscription when physical removal throws', () => {
    const target = createTarget({ shouldThrowOnRemove: true });
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    let calls = 0;
    const result = browser.subscribeErrorSources(() => {
      calls += 1;
    });
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe()).toMatchObject({
      ok: true,
      code: 'unsubscribed',
      diagnosticsAdded: 2,
    });
    target.dispatch('error', { target: window, message: 'Synthetic' });
    expect(calls).toBe(0);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('removal-secret');
  });

  it('returns stable failures for invalid listeners and missing window methods', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    // null is intentional untrusted runtime input; production code uses no assertion.
    expect(browser.subscribeErrorSources(null as never)).toEqual({
      ok: false,
      code: 'invalid_listener',
      diagnosticsAdded: 0,
    });
    expect(browser.subscribeErrorSources(() => undefined)).toEqual({
      ok: false,
      code: 'environment_unavailable',
      diagnosticsAdded: 0,
    });
  });

  it('destroys all subscriptions, rejects new ones, and never revives', () => {
    const target = createTarget();
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    browser.subscribeErrorSources(() => undefined);
    expect(browser.destroy().code).toBe('destroyed');
    expect(browser.destroy().code).toBe('already_destroyed');
    expect(browser.subscribeErrorSources(() => undefined)).toEqual({
      ok: false,
      code: 'destroyed',
      diagnosticsAdded: 0,
    });
    expect(target.registrations).toEqual([]);
  });
});
