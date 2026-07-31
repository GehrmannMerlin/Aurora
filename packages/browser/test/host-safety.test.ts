import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment } from '../src/index.js';

interface Target {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatch(type: string, event?: unknown): void;
}

function target(): Target {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type, listener): void {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener): void {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = {}): void {
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Browser host safety', () => {
  it('does not overwrite handlers, native APIs, history, prototypes, or console', () => {
    const windowTarget = target();
    const documentTarget = target();
    const onerror = (): boolean => true;
    const onunhandledrejection = (): boolean => true;
    const fetchValue = (): Promise<Response> => Promise.resolve(new Response());
    class SyntheticXhr {
      readonly synthetic = true;
    }
    const historyValue = { pushState: (): void => undefined, replaceState: (): void => undefined };
    const pushState = historyValue.pushState;
    const replaceState = historyValue.replaceState;
    const windowValue = {
      ...windowTarget,
      location: { href: 'https://example.test/?token=private' },
      onerror,
      onunhandledrejection,
      fetch: fetchValue,
      XMLHttpRequest: SyntheticXhr,
      history: historyValue,
    };
    const prototype = Reflect.getPrototypeOf(windowValue);
    vi.stubGlobal('window', windowValue);
    vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const browser = createBrowserEnvironment();
    const result = browser.subscribePageLifecycle(() => undefined);
    if (result.ok) result.subscription.unsubscribe();
    browser.destroy();
    browser.readPageSnapshot();
    expect(windowValue).toMatchObject({
      onerror,
      onunhandledrejection,
      fetch: fetchValue,
      XMLHttpRequest: SyntheticXhr,
      history: historyValue,
    });
    expect(Reflect.getPrototypeOf(windowValue)).toBe(prototype);
    expect(historyValue.pushState).toBe(pushState);
    expect(historyValue.replaceState).toBe(replaceState);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('contains one throwing callback and still notifies another callback', () => {
    const windowTarget = target();
    const documentTarget = target();
    vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const browser = createBrowserEnvironment();
    let healthyCalls = 0;
    browser.subscribePageLifecycle((): never => {
      throw new Error('authorization=secret');
    });
    browser.subscribePageLifecycle(() => {
      healthyCalls += 1;
    });
    documentTarget.dispatch('visibilitychange');
    expect(healthyCalls).toBe(1);
    expect(browser.getDiagnostics()).toMatchObject([
      { sequence: 1, code: 'callback_failed', operation: 'notify', eventType: 'visibility_change' },
    ]);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('authorization');
  });

  it('bounds diagnostics to the newest 100 entries without reusing sequence numbers', () => {
    const windowTarget = target();
    const documentTarget = target();
    vi.stubGlobal('window', { ...windowTarget, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', { ...documentTarget, visibilityState: 'visible' });
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const browser = createBrowserEnvironment();
    browser.subscribePageLifecycle((): never => {
      throw new Error('private');
    });
    for (let index = 0; index < 120; index += 1) documentTarget.dispatch('visibilitychange');
    const diagnostics = browser.getDiagnostics();
    expect(diagnostics).toHaveLength(100);
    expect(diagnostics[0]?.sequence).toBe(21);
    expect(diagnostics[99]?.sequence).toBe(120);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(diagnostics.every(Object.isFrozen)).toBe(true);
  });
});
