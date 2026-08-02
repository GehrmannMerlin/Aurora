import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserRequestOutcome } from '../src/index.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { createRequestObserver } from '../src/request-observer.js';

afterEach(() => vi.unstubAllGlobals());

function hostLike(): {
  readonly windowTarget: object;
  readonly documentTarget: unknown;
  readonly navigatorTarget: unknown;
  readonly performanceTarget: unknown;
} {
  const windowTarget = {
    addEventListener: (): void => undefined,
    removeEventListener: (): void => undefined,
  };
  return {
    windowTarget,
    documentTarget: {},
    navigatorTarget: {},
    performanceTarget: {},
  };
}

function installFetchHost(windowTarget: object, fetchImpl: (...args: unknown[]) => unknown): void {
  Reflect.set(windowTarget, 'fetch', fetchImpl);
}

function installXhrHost(windowTarget: object, XhrImpl: new () => unknown): void {
  Reflect.set(windowTarget, 'XMLHttpRequest', XhrImpl);
}

function makeNativeXhr(windowTarget: object): new () => {
  readonly open: (...args: unknown[]) => unknown;
  readonly send: (...args: unknown[]) => unknown;
  readonly abort: (...args: unknown[]) => unknown;
} {
  const NativeXhr = class {
    open(): unknown {
      return undefined;
    }
    send(): unknown {
      return undefined;
    }
    abort(): unknown {
      return undefined;
    }
    addEventListener(): void {
      return undefined;
    }
    removeEventListener(): void {
      return undefined;
    }
  };
  installXhrHost(windowTarget, NativeXhr);
  return NativeXhr;
}

describe('request observer host install and restore', () => {
  it('installs on first subscriber and restores on last release', () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    const NativeXhr = makeNativeXhr(host.windowTarget);
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const listener = (): void => undefined;
    expect(observer.subscribe(listener)).toBe(true);
    expect(observer.isInstalled()).toBe(true);
    expect(Reflect.get(host.windowTarget, 'fetch')).not.toBe(originalFetch);
    expect(Reflect.get(host.windowTarget, 'XMLHttpRequest')).not.toBe(NativeXhr);
    expect(observer.unsubscribe(listener)).toBe(true);
    expect(observer.isInstalled()).toBe(false);
    expect(Reflect.get(host.windowTarget, 'fetch')).toBe(originalFetch);
    expect(Reflect.get(host.windowTarget, 'XMLHttpRequest')).toBe(NativeXhr);
  });

  it('keeps installed across multiple subscribers and restores only after last release', () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    makeNativeXhr(host.windowTarget);
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const first = (): void => undefined;
    const second = (): void => undefined;
    expect(observer.subscribe(first)).toBe(true);
    expect(observer.subscribe(second)).toBe(true);
    expect(Reflect.get(host.windowTarget, 'fetch')).not.toBe(originalFetch);
    expect(observer.unsubscribe(first)).toBe(true);
    expect(observer.isInstalled()).toBe(true);
    expect(Reflect.get(host.windowTarget, 'fetch')).not.toBe(originalFetch);
    expect(observer.unsubscribe(second)).toBe(true);
    expect(observer.isInstalled()).toBe(false);
    expect(Reflect.get(host.windowTarget, 'fetch')).toBe(originalFetch);
  });

  it('preserves instanceof for XHR instances created through the wrapper', () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const NativeXhr = makeNativeXhr(host.windowTarget);
    const observer = createRequestObserver(host, diagnostics);
    const listener = (): void => undefined;
    expect(observer.subscribe(listener)).toBe(true);
    const WrappedXhr = Reflect.get(host.windowTarget, 'XMLHttpRequest') as new () => unknown;
    const instance = new WrappedXhr();
    expect(instance instanceof NativeXhr).toBe(true);
  });

  it('returns false when install fails because fetch is missing', () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const observer = createRequestObserver(host, diagnostics);
    expect(observer.subscribe(() => undefined)).toBe(false);
    expect(observer.isInstalled()).toBe(false);
  });

  it('passes fetch args through and does not consume the response body', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const seen: unknown[] = [];
    const originalFetch = (input: unknown, init?: unknown): Promise<unknown> => {
      seen.push(input, init);
      return Promise.resolve({ status: 200, body: null });
    };
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const events: unknown[] = [];
    const listener = (event: unknown): void => {
      events.push(event);
    };
    expect(observer.subscribe(listener)).toBe(true);
    const input = { url: 'https://example.test/a?x=1' };
    const init = { method: 'POST' };
    const result = await (
      Reflect.get(host.windowTarget, 'fetch') as (
        input: unknown,
        init?: unknown,
      ) => Promise<unknown>
    )(input, init);
    expect(result).toEqual({ status: 200, body: null });
    expect(seen[0]).toBe(input);
    expect(seen[1]).toBe(init);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(1);
  });

  it('preserves fetch synchronous throw and rejection reason', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.reject(new TypeError('network down'));
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    expect(observer.subscribe(() => undefined)).toBe(true);
    const wrapped = Reflect.get(host.windowTarget, 'fetch') as () => Promise<unknown>;
    await expect(wrapped()).rejects.toThrow('network down');
  });

  it('notifies network_error on fetch rejection and canceled on AbortError', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    let mode: 'network' | 'abort' = 'network';
    const originalFetch = (): Promise<unknown> => {
      if (mode === 'network') return Promise.reject(new TypeError('down'));
      const error = new Error('aborted');
      Object.defineProperty(error, 'name', { value: 'AbortError' });
      return Promise.reject(error);
    };
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const outcomes: string[] = [];
    observer.subscribe((event) => outcomes.push(event.outcome));
    await (Reflect.get(host.windowTarget, 'fetch') as (input: unknown) => Promise<unknown>)(
      'https://example.test/reports',
    ).catch(() => undefined);
    mode = 'abort';
    await (Reflect.get(host.windowTarget, 'fetch') as (input: unknown) => Promise<unknown>)(
      'https://example.test/upload',
    ).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outcomes).toEqual([BrowserRequestOutcome.NetworkError, BrowserRequestOutcome.Canceled]);
  });

  it('does not use module-level mutable state across two observers', () => {
    const firstHost = hostLike();
    const secondHost = hostLike();
    const firstFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    const secondFetch = (): Promise<unknown> => Promise.resolve({ status: 201 });
    installFetchHost(firstHost.windowTarget, firstFetch);
    installFetchHost(secondHost.windowTarget, secondFetch);
    const first = createRequestObserver(firstHost, createDiagnosticStore());
    const second = createRequestObserver(secondHost, createDiagnosticStore());
    expect(first.subscribe(() => undefined)).toBe(true);
    expect(second.subscribe(() => undefined)).toBe(true);
    expect(Reflect.get(firstHost.windowTarget, 'fetch')).not.toBe(firstFetch);
    expect(Reflect.get(secondHost.windowTarget, 'fetch')).not.toBe(secondFetch);
    first.destroy();
    expect(Reflect.get(firstHost.windowTarget, 'fetch')).toBe(firstFetch);
    expect(Reflect.get(secondHost.windowTarget, 'fetch')).not.toBe(secondFetch);
    second.destroy();
    expect(Reflect.get(secondHost.windowTarget, 'fetch')).toBe(secondFetch);
  });

  it('covers fetch init method override and URL object input', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const events: { method: string; url: string }[] = [];
    observer.subscribe((event) => {
      if ('method' in event) events.push({ method: event.method, url: event.url });
    });
    const wrapped = Reflect.get(host.windowTarget, 'fetch') as (
      input: unknown,
      init?: unknown,
    ) => Promise<unknown>;
    await wrapped(new URL('https://example.test/x?q=1'), { method: 'PUT' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([{ method: 'PUT', url: 'https://example.test/x' }]);
  });

  it('does not produce a fact when the input URL cannot be sanitized', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const events: unknown[] = [];
    observer.subscribe((event) => events.push(event));
    const wrapped = Reflect.get(host.windowTarget, 'fetch') as (input: unknown) => Promise<unknown>;
    await wrapped('relative/path');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(0);
  });

  it('covers fetch http_error outcome for a 4xx response', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 404 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const events: string[] = [];
    observer.subscribe((event) => events.push(event.outcome));
    await (Reflect.get(host.windowTarget, 'fetch') as (input: string) => Promise<unknown>)(
      'https://e.test/a',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([BrowserRequestOutcome.HttpError]);
  });

  it('covers XHR open with a non-string method argument and non-string URL', () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const NativeXhr = makeNativeXhr(host.windowTarget);
    const observer = createRequestObserver(host, diagnostics);
    observer.subscribe(() => undefined);
    const WrappedXhr = Reflect.get(host.windowTarget, 'XMLHttpRequest') as new () => {
      open: (...args: unknown[]) => unknown;
      send: (...args: unknown[]) => unknown;
    };
    const xhr = new WrappedXhr();
    expect(() => {
      xhr.open({ method: 'POST' }, null);
      xhr.send();
    }).not.toThrow();
    expect(xhr instanceof NativeXhr).toBe(true);
  });

  it('records callback_failed diagnostics without leaking to other subscribers', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const healthy: string[] = [];
    observer.subscribe(() => {
      throw new Error('callback-private');
    });
    observer.subscribe((event) => healthy.push(event.outcome));
    await (Reflect.get(host.windowTarget, 'fetch') as (input: string) => Promise<unknown>)(
      'https://e.test/a',
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(healthy).toEqual([BrowserRequestOutcome.Success]);
    const codes = diagnostics.getDiagnostics().map((entry) => entry.code);
    expect(codes).toContain('callback_failed');
  });

  it('covers fetch install failure rollback when fetch is present but XHR missing', () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    expect(observer.subscribe(() => undefined)).toBe(true);
    expect(observer.isInstalled()).toBe(true);
    expect(Reflect.get(host.windowTarget, 'fetch')).not.toBe(originalFetch);
  });

  it('covers fetch URL input that is an object with an href property', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const urls: string[] = [];
    observer.subscribe((event) => {
      if ('url' in event) urls.push(event.url);
    });
    const wrapped = Reflect.get(host.windowTarget, 'fetch') as (input: unknown) => Promise<unknown>;
    await wrapped({ href: 'https://example.test/href-path?q=1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(urls).toEqual(['https://example.test/href-path']);
  });

  it('covers fetch input that is neither a string, URL, nor Request object', async () => {
    const host = hostLike();
    const diagnostics = createDiagnosticStore();
    const originalFetch = (): Promise<unknown> => Promise.resolve({ status: 200 });
    installFetchHost(host.windowTarget, originalFetch);
    const observer = createRequestObserver(host, diagnostics);
    const events: unknown[] = [];
    observer.subscribe((event) => events.push(event));
    const wrapped = Reflect.get(host.windowTarget, 'fetch') as (input: unknown) => Promise<unknown>;
    await wrapped(42);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(0);
  });
});
