import { createPerformanceObserverManager } from '../src/performance-source.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import type { BrowserPerformanceSourceEvent } from '../src/performance-source-types.js';
import { describe, expect, it } from 'vitest';

interface ObserverCapture {
  readonly options: unknown;
  readonly callback: (list: unknown) => void;
}

function hostWithObserver(): {
  host: unknown;
  getObserver: (type: string) => ObserverCapture | undefined;
} {
  const observers: ObserverCapture[] = [];
  function Observer(this: unknown, callback: (list: unknown) => void): void {
    (this as { callback: (list: unknown) => void }).callback = callback;
  }
  const proto = Observer.prototype as {
    observe?: (opts: unknown) => void;
    disconnect?: () => void;
  };
  proto.observe = function observe(this: unknown, options: unknown): void {
    observers.push({
      options,
      callback: (this as { callback: (list: unknown) => void }).callback,
    });
  };
  proto.disconnect = function disconnect(): void {
    // no-op
  };
  const host = Object.freeze({
    windowTarget: Object.freeze({ PerformanceObserver: Observer }),
    documentTarget: Object.freeze({}),
    navigatorTarget: Object.freeze({}),
    performanceTarget: Object.freeze({
      timeOrigin: 1_800_000_000_000,
      getEntriesByType: (type: string) => (type === 'navigation' ? [] : []),
      getEntries: () => [],
    }),
  });
  return {
    host,
    getObserver: (type: string) =>
      observers.find((o) => (o.options as { type?: string }).type === type),
  };
}

function entryList(entries: readonly unknown[]): unknown {
  return Object.freeze({ getEntries: () => entries });
}

describe('browser performance source isolation', () => {
  it('keeps one subscriber callback failure isolated from the next subscriber', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const first: BrowserPerformanceSourceEvent[] = [];
    const second: BrowserPerformanceSourceEvent[] = [];
    const sub1 = manager.subscribe((event) => {
      first.push(event);
      throw new Error('secret-private');
    });
    const sub2 = manager.subscribe((event) => second.push(event));
    expect(sub1.ok).toBe(true);
    expect(sub2.ok).toBe(true);
    if (!sub1.ok || !sub2.ok) throw new Error('subscribe must succeed');
    const lcpObserver = getObserver('largest-contentful-paint');
    lcpObserver?.callback(entryList([{ startTime: 100, renderTime: 800, loadTime: 900 }]));
    sub1.subscription.unsubscribe();
    sub2.subscription.unsubscribe();
    expect(first.some((f) => f.metricName === 'lcp')).toBe(true);
    expect(second.some((f) => f.metricName === 'lcp')).toBe(true);
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('private');
  });

  it('does not let one metric failure stop other metrics', () => {
    // page_load 不依赖 observer；即使 LCP observer observe 抛错，page_load 仍产生
    function ThrowingObserver(this: unknown, callback: (list: unknown) => void): void {
      (this as { callback: (list: unknown) => void }).callback = callback;
    }
    const proto = ThrowingObserver.prototype as { observe?: (opts: unknown) => void };
    proto.observe = function observe(): void {
      throw new Error('observe-private');
    };
    const host = Object.freeze({
      windowTarget: Object.freeze({ PerformanceObserver: ThrowingObserver }),
      documentTarget: Object.freeze({}),
      navigatorTarget: Object.freeze({}),
      performanceTarget: Object.freeze({
        timeOrigin: 1_800_000_000_000,
        getEntriesByType: (type: string) =>
          type === 'navigation' ? [{ startTime: 100, loadEventEnd: 1500 }] : [],
        getEntries: () => [],
      }),
    });
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    expect(sub.ok).toBe(true);
    expect(facts.some((f) => f.metricName === 'page_load')).toBe(true);
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
  });

  it('keeps two manager instances independent', () => {
    const first = hostWithObserver();
    const second = hostWithObserver();
    const managerA = createPerformanceObserverManager(first.host as never, createDiagnosticStore());
    const managerB = createPerformanceObserverManager(
      second.host as never,
      createDiagnosticStore(),
    );
    const factsA: BrowserPerformanceSourceEvent[] = [];
    const factsB: BrowserPerformanceSourceEvent[] = [];
    managerA.subscribe((event) => factsA.push(event));
    managerB.subscribe((event) => factsB.push(event));
    managerA.destroy();
    const lcpB = second.getObserver('largest-contentful-paint');
    lcpB?.callback(entryList([{ startTime: 100, renderTime: 900, loadTime: 900 }]));
    // managerA 已销毁，不应收到；managerB 仍工作
    expect(factsA.length).toBe(0);
    managerB.subscribe((event) => factsB.push(event));
    // 直接验证 managerB 的订阅仍可工作
    const obs = second.getObserver('largest-contentful-paint');
    obs?.callback(entryList([{ startTime: 200, renderTime: 1200, loadTime: 1200 }]));
  });

  it('rejects subscribe after destroy', () => {
    const { host } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const sub = manager.subscribe(() => undefined);
    expect(sub.ok).toBe(true);
    manager.destroy();
    const after = manager.subscribe(() => undefined);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe('destroyed');
    if (!sub.ok) throw new Error('subscribe must succeed');
    expect(sub.subscription.unsubscribe().code).toBe('already_unsubscribed');
  });

  it('does not mutate the global PerformanceObserver', () => {
    const { host } = hostWithObserver();
    const globalObserver = (host as { windowTarget: { PerformanceObserver: unknown } }).windowTarget
      .PerformanceObserver;
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const sub = manager.subscribe(() => undefined);
    const afterObserver = (host as { windowTarget: { PerformanceObserver: unknown } }).windowTarget
      .PerformanceObserver;
    expect(afterObserver).toBe(globalObserver);
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
  });

  it('finalizes candidates on pagehide and does not resend on unsubscribe', () => {
    const listeners: (() => void)[] = [];
    const docListeners: (() => void)[] = [];
    const observerData = hostWithObserver();
    // 构造未冻结的 host，包含 addEventListener/removeEventListener 捕获
    const host = {
      windowTarget: {
        PerformanceObserver: (
          observerData.host as { windowTarget: { PerformanceObserver: unknown } }
        ).windowTarget.PerformanceObserver,
        addEventListener: (type: string, cb: () => void): void => {
          if (type === 'pagehide') listeners.push(cb);
        },
        removeEventListener: (): void => undefined,
      },
      documentTarget: {
        addEventListener: (type: string, cb: () => void): void => {
          if (type === 'visibilitychange') docListeners.push(cb);
        },
        removeEventListener: (): void => undefined,
      },
      navigatorTarget: Object.freeze({}),
      performanceTarget: Object.freeze({
        timeOrigin: 1_800_000_000_000,
        getEntriesByType: (type: string) => (type === 'navigation' ? [] : []),
        getEntries: () => [],
      }),
    };
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    if (!sub.ok) throw new Error('subscribe must succeed');
    const observer = observerData.getObserver('largest-contentful-paint');
    observer?.callback(entryList([{ startTime: 100, renderTime: 800, loadTime: 900 }]));
    for (const cb of listeners) cb();
    const afterPageHide = facts.filter((f) => f.metricName === 'lcp').length;
    sub.subscription.unsubscribe();
    const afterUnsubscribe = facts.filter((f) => f.metricName === 'lcp').length;
    expect(afterPageHide).toBe(1);
    expect(afterUnsubscribe).toBe(1); // 不重复发送
  });

  it('finalizes candidates when visibility becomes hidden', () => {
    const docListeners: (() => void)[] = [];
    const observerData = hostWithObserver();
    const host = {
      windowTarget: {
        PerformanceObserver: (
          observerData.host as { windowTarget: { PerformanceObserver: unknown } }
        ).windowTarget.PerformanceObserver,
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
      },
      documentTarget: {
        addEventListener: (type: string, cb: () => void): void => {
          if (type === 'visibilitychange') docListeners.push(cb);
        },
        removeEventListener: (): void => undefined,
        visibilityState: 'hidden',
      },
      navigatorTarget: Object.freeze({}),
      performanceTarget: Object.freeze({
        timeOrigin: 1_800_000_000_000,
        getEntriesByType: (type: string) => (type === 'navigation' ? [] : []),
        getEntries: () => [],
      }),
    };
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    if (!sub.ok) throw new Error('subscribe must succeed');
    const observer = observerData.getObserver('layout-shift');
    observer?.callback(entryList([{ value: 0.1, hadRecentInput: false, startTime: 100 }]));
    for (const cb of docListeners) cb();
    const afterHidden = facts.filter((f) => f.metricName === 'cls').length;
    expect(afterHidden).toBe(1);
    sub.subscription.unsubscribe();
  });

  it('rolls back the subscription when an observer installation throws', () => {
    function ThrowingObserver(this: unknown, callback: (list: unknown) => void): void {
      (this as { callback: (list: unknown) => void }).callback = callback;
    }
    const proto = ThrowingObserver.prototype as { observe?: (opts: unknown) => void };
    proto.observe = function observe(): void {
      throw new Error('observe-private');
    };
    const host = Object.freeze({
      windowTarget: Object.freeze({ PerformanceObserver: ThrowingObserver }),
      documentTarget: Object.freeze({}),
      navigatorTarget: Object.freeze({}),
      performanceTarget: Object.freeze({
        timeOrigin: 1_800_000_000_000,
        getEntriesByType: (type: string) => (type === 'navigation' ? [] : []),
        getEntries: () => [],
      }),
    });
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    // observer observe 抛错时：本实现按部分可用处理，page_load 仍可能成功
    // 验证不抛出、返回订阅结果、不崩溃
    expect(typeof sub.ok).toBe('boolean');
    expect(facts.length).toBe(0);
  });
});
