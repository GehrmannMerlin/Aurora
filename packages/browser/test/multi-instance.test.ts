import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('Browser multi-instance isolation', () => {
  it('destroying one instance leaves another instance subscribed', () => {
    const listeners = new Map<string, Set<(event: unknown) => void>>();
    const addEventListener = (type: string, listener: (event: unknown) => void): void => {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    };
    const removeEventListener = (type: string, listener: (event: unknown) => void): void => {
      listeners.get(type)?.delete(listener);
    };
    const windowTarget = {
      addEventListener,
      removeEventListener,
      location: { href: 'https://example.test/' },
    };
    const documentTarget = { addEventListener, removeEventListener, visibilityState: 'visible' };
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const first = createBrowserEnvironment();
    const second = createBrowserEnvironment();
    let firstCalls = 0;
    let secondCalls = 0;
    first.subscribePageLifecycle(() => {
      firstCalls += 1;
    });
    second.subscribePageLifecycle(() => {
      secondCalls += 1;
    });
    first.destroy();
    for (const listener of [...(listeners.get('pageshow') ?? [])]) listener({ persisted: true });
    expect(firstCalls).toBe(0);
    expect(secondCalls).toBe(1);
    expect(first.getDiagnostics()).toEqual([]);
    expect(second.getDiagnostics()).toEqual([]);
    second.destroy();
    expect(listeners.get('pageshow')?.size ?? 0).toBe(0);
  });
});
