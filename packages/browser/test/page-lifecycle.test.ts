import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserSubscribeCode,
  PageLifecycleEventType,
  createBrowserEnvironment,
  type PageLifecycleEvent,
} from '../src/index.js';

interface FakeTarget {
  readonly addEventListener: (type: string, listener: (event: unknown) => void) => void;
  readonly removeEventListener: (type: string, listener: (event: unknown) => void) => void;
  readonly dispatch: (type: string, event?: unknown) => void;
  readonly listenerCount: () => number;
}

function createTarget(
  options: { readonly throwOnAdd?: string; readonly throwOnRemove?: boolean } = {},
): FakeTarget {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type, listener): void {
      if (options.throwOnAdd === type) throw new Error('registration-secret');
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener): void {
      if (options.throwOnRemove === true) throw new Error('removal-secret');
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    listenerCount: (): number => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function installHost(windowTarget: FakeTarget, documentTarget: FakeTarget): void {
  vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
  vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
  vi.stubGlobal('navigator', { userAgent: 'synthetic-agent' });
  vi.stubGlobal('performance', { now: (): number => 1 });
}

afterEach(() => vi.unstubAllGlobals());

describe('page lifecycle subscription', () => {
  it('delivers stable visibility, pagehide, and pageshow events', () => {
    const windowTarget = createTarget();
    const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    const events: PageLifecycleEvent[] = [];
    const result = browser.subscribePageLifecycle((event) => events.push(event));
    expect(result).toMatchObject({
      ok: true,
      code: BrowserSubscribeCode.Subscribed,
      diagnosticsAdded: 0,
    });
    if (!result.ok) throw new Error('subscription must succeed');
    documentTarget.dispatch('visibilitychange');
    windowTarget.dispatch('pagehide', { persisted: true });
    windowTarget.dispatch('pageshow', { persisted: false });
    expect(events).toEqual([
      { type: PageLifecycleEventType.VisibilityChange, visibilityState: 'visible' },
      { type: PageLifecycleEventType.PageHide, isPersisted: true },
      { type: PageLifecycleEventType.PageShow, isPersisted: false },
    ]);
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it('cancels once and treats repeated cancellation as a no-op', () => {
    const windowTarget = createTarget();
    const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    let calls = 0;
    const result = browser.subscribePageLifecycle(() => {
      calls += 1;
    });
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe()).toEqual({
      ok: true,
      code: 'unsubscribed',
      diagnosticsAdded: 0,
    });
    expect(result.subscription.unsubscribe()).toEqual({
      ok: true,
      code: 'already_unsubscribed',
      diagnosticsAdded: 0,
    });
    documentTarget.dispatch('visibilitychange');
    expect(calls).toBe(0);
    expect(windowTarget.listenerCount()).toBe(0);
    expect(documentTarget.listenerCount()).toBe(0);
    const replacement = browser.subscribePageLifecycle(() => {
      calls += 1;
    });
    expect(replacement.ok).toBe(true);
    if (replacement.ok) replacement.subscription.unsubscribe();
  });

  it('rolls back earlier listeners when later registration throws', () => {
    const windowTarget = createTarget({ throwOnAdd: 'pagehide' });
    const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    expect(browser.subscribePageLifecycle(() => undefined)).toMatchObject({
      ok: false,
      code: 'listener_registration_failed',
      diagnosticsAdded: 1,
    });
    expect(windowTarget.listenerCount()).toBe(0);
    expect(documentTarget.listenerCount()).toBe(0);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('registration-secret');
  });

  it('reports a throwing listener method getter as registration failure', () => {
    const windowTarget = createTarget();
    const documentTarget = {
      get addEventListener(): never {
        throw new Error('method-secret');
      },
      removeEventListener: (): void => undefined,
      visibilityState: 'visible',
    };
    vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const browser = createBrowserEnvironment();
    expect(browser.subscribePageLifecycle(() => undefined)).toMatchObject({
      ok: false,
      code: 'listener_registration_failed',
      diagnosticsAdded: 1,
    });
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('method-secret');
  });

  it('logically disables a subscription even when removeEventListener throws', () => {
    const windowTarget = createTarget({ throwOnRemove: true });
    const documentTarget = createTarget({ throwOnRemove: true });
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    let calls = 0;
    const result = browser.subscribePageLifecycle(() => {
      calls += 1;
    });
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe()).toMatchObject({
      ok: true,
      code: 'unsubscribed',
      diagnosticsAdded: 3,
    });
    documentTarget.dispatch('visibilitychange');
    windowTarget.dispatch('pagehide');
    expect(calls).toBe(0);
  });

  it('maps a throwing persisted getter to null without leaking the exception', () => {
    const windowTarget = createTarget();
    const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    const events: PageLifecycleEvent[] = [];
    browser.subscribePageLifecycle((event) => events.push(event));
    const nativeEvent = {
      get persisted(): never {
        throw new Error('persisted-secret');
      },
    };
    windowTarget.dispatch('pagehide', nativeEvent);
    expect(events).toEqual([{ type: 'page_hide', isPersisted: null }]);
    expect(browser.getDiagnostics()).toMatchObject([
      { code: 'property_read_failed', operation: 'notify', eventType: 'page_hide' },
    ]);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('persisted-secret');
  });

  it('destroys every subscription, rejects new subscriptions, and is idempotent', () => {
    const windowTarget = createTarget();
    const documentTarget = createTarget();
    installHost(windowTarget, documentTarget);
    const browser = createBrowserEnvironment();
    let calls = 0;
    const first = browser.subscribePageLifecycle(() => {
      calls += 1;
    });
    const second = browser.subscribePageLifecycle(() => {
      calls += 1;
    });
    expect(first.ok && second.ok).toBe(true);
    expect(browser.destroy()).toEqual({ ok: true, code: 'destroyed', diagnosticsAdded: 0 });
    expect(browser.destroy()).toEqual({ ok: true, code: 'already_destroyed', diagnosticsAdded: 0 });
    expect(browser.subscribePageLifecycle(() => undefined)).toEqual({
      ok: false,
      code: 'destroyed',
      diagnosticsAdded: 0,
    });
    expect(() => browser.getCapabilities()).not.toThrow();
    expect(() => browser.readPageSnapshot()).not.toThrow();
    expect(() => browser.getDiagnostics()).not.toThrow();
    windowTarget.dispatch('pageshow');
    expect(calls).toBe(0);
    if (first.ok) expect(first.subscription.unsubscribe().code).toBe('already_unsubscribed');
  });

  it('returns stable failures for a non-callable listener and unavailable environment', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const browser = createBrowserEnvironment();
    // null listener is a negative runtime-boundary test; production code uses no assertion.
    expect(browser.subscribePageLifecycle(null as never)).toEqual({
      ok: false,
      code: 'invalid_listener',
      diagnosticsAdded: 0,
    });
    expect(browser.subscribePageLifecycle(() => undefined)).toEqual({
      ok: false,
      code: 'environment_unavailable',
      diagnosticsAdded: 0,
    });
  });
});
