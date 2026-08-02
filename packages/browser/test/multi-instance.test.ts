import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserRequestOutcome } from '../src/index.js';
import { createBrowserEnvironment } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

function stubRequestHost(): { readonly windowTarget: object } {
  const windowTarget = {
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
    fetch: (): Promise<unknown> => Promise.resolve({ status: 200 }),
    XMLHttpRequest: class {
      open(): void {
        return undefined;
      }
      send(): void {
        return undefined;
      }
      abort(): void {
        return undefined;
      }
      addEventListener(): void {
        return undefined;
      }
      removeEventListener(): void {
        return undefined;
      }
    },
  };
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('performance', { now: (): number => 1 });
  return { windowTarget };
}

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

  it('destroying one error source instance leaves another active', () => {
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
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', { userAgent: 'agent' });
    vi.stubGlobal('performance', { now: (): number => 1 });
    const first = createBrowserEnvironment();
    const second = createBrowserEnvironment();
    let firstCalls = 0;
    let secondCalls = 0;
    first.subscribeErrorSources(() => {
      firstCalls += 1;
    });
    second.subscribeErrorSources(() => {
      secondCalls += 1;
    });
    first.destroy();
    for (const listener of [...(listeners.get('error') ?? [])]) {
      listener({ target: windowTarget, message: 'Synthetic' });
    }
    expect({ firstCalls, secondCalls }).toEqual({ firstCalls: 0, secondCalls: 1 });
    second.destroy();
    expect(listeners.get('error')?.size ?? 0).toBe(0);
  });

  it('keeps two request instances isolated and restores references when the last instance releases', async () => {
    const { windowTarget } = stubRequestHost();
    const originalFetch = Reflect.get(windowTarget, 'fetch') as (input: string) => Promise<unknown>;
    const originalXhr: unknown = Reflect.get(windowTarget, 'XMLHttpRequest');
    const first = createBrowserEnvironment();
    const second = createBrowserEnvironment();
    const firstEvents: string[] = [];
    const secondEvents: string[] = [];
    first.subscribeRequests((event) => {
      firstEvents.push(event.outcome);
    });
    second.subscribeRequests((event) => {
      secondEvents.push(event.outcome);
    });
    const wrappedFetch = Reflect.get(windowTarget, 'fetch') as (input: string) => Promise<unknown>;
    await wrappedFetch('https://example.test/a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstEvents).toEqual([BrowserRequestOutcome.Success]);
    expect(secondEvents).toEqual([BrowserRequestOutcome.Success]);
    // Destroy the second (inner) instance first so its wrapper unwinds to the first instance's
    // wrapper, then destroy the first (outer) instance so the pristine original is restored.
    second.destroy();
    expect(firstEvents).toHaveLength(1);
    expect(secondEvents).toHaveLength(1);
    first.destroy();
    expect(Reflect.get(windowTarget, 'fetch')).toBe(originalFetch);
    expect(Reflect.get(windowTarget, 'XMLHttpRequest')).toBe(originalXhr);
  });
});
