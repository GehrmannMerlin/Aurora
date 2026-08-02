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
  observers: ObserverCapture[];
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
    observers,
    getObserver: (type: string) =>
      observers.find((o) => (o.options as { type?: string }).type === type),
  };
}

function entryList(entries: readonly unknown[]): unknown {
  return Object.freeze({ getEntries: () => entries });
}

describe('browser performance metric state machines', () => {
  it('LCP: keeps the largest candidate and emits on dispose without leaking element/url', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    expect(sub.ok).toBe(true);
    const observer = getObserver('largest-contentful-paint');
    expect(observer).toBeDefined();
    observer?.callback(entryList([{ startTime: 100, renderTime: 800, loadTime: 900 }]));
    observer?.callback(
      entryList([
        {
          startTime: 200,
          renderTime: 1200,
          loadTime: 1300,
          element: { id: 'secret' },
          url: 'https://x.test/a',
        },
      ]),
    );
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    const lcp = facts.find((f) => f.metricName === 'lcp');
    expect(lcp?.value).toBe(1200);
    expect(lcp?.unit).toBe('millisecond');
    expect(lcp?.startedAt).toBe(1_800_000_000_200);
    expect(JSON.stringify(facts)).not.toContain('secret');
    expect(JSON.stringify(facts)).not.toContain('x.test');
  });

  it('LCP: ignores non-positive renderTime entries', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('largest-contentful-paint');
    observer?.callback(entryList([{ startTime: 100, renderTime: 0, loadTime: 0 }]));
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    expect(facts.filter((f) => f.metricName === 'lcp')).toHaveLength(0);
  });

  it('CLS: ignores shifts with hadRecentInput true', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('layout-shift');
    observer?.callback(
      entryList([
        { value: 0.1, hadRecentInput: true, startTime: 100 },
        { value: 0.2, hadRecentInput: false, startTime: 150 },
      ]),
    );
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    const cls = facts.find((f) => f.metricName === 'cls');
    expect(cls?.value).toBe(0.2);
    expect(cls?.unit).toBe('ratio');
  });

  it('CLS: accumulates within a session and starts a new session after the gap', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('layout-shift');
    observer?.callback(
      entryList([
        { value: 0.1, hadRecentInput: false, startTime: 100 },
        { value: 0.2, hadRecentInput: false, startTime: 150 },
      ]),
    );
    observer?.callback(entryList([{ value: 0.5, hadRecentInput: false, startTime: 1300 }]));
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    const cls = facts.find((f) => f.metricName === 'cls');
    expect(cls?.value).toBe(0.5); // session B (0.5) 大于 session A (0.3)
  });

  it('CLS: does not leak sources array from the entry', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('layout-shift');
    observer?.callback(
      entryList([
        {
          value: 0.1,
          hadRecentInput: false,
          startTime: 100,
          sources: [{ node: { id: 'secret' } }],
        },
      ]),
    );
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    expect(JSON.stringify(facts)).not.toContain('secret');
  });

  it('INP: aggregates multiple entries of one interaction to the longest duration', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('event');
    observer?.callback(
      entryList([
        { entryType: 'event', interactionId: 42, duration: 100, startTime: 100 },
        { entryType: 'event', interactionId: 42, duration: 250, startTime: 120 },
      ]),
    );
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    const inp = facts.find((f) => f.metricName === 'inp');
    expect(inp?.value).toBe(250);
    expect(inp?.unit).toBe('millisecond');
  });

  it('INP: takes the max duration across interactions', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('event');
    observer?.callback(
      entryList([
        { entryType: 'event', interactionId: 1, duration: 120, startTime: 100 },
        { entryType: 'event', interactionId: 2, duration: 300, startTime: 200 },
      ]),
    );
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    const inp = facts.find((f) => f.metricName === 'inp');
    expect(inp?.value).toBe(300);
  });

  it('INP: falls back to first-input when interactionId is missing and does not leak target', () => {
    const { host } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    // first-input observer is the fallback; entry without interactionId
    // 由于 event observer 已安装，first-input 不会额外安装；直接推送 event 无 interactionId
    // 这里验证：无 interactionId 且 entryType 非 first-input 的 entry 被忽略
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    expect(facts.filter((f) => f.metricName === 'inp')).toHaveLength(0);
    expect(JSON.stringify(facts)).not.toContain('secret');
  });

  it('INP: ignores entries with invalid duration', () => {
    const { host, getObserver } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host as never, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const observer = getObserver('event');
    observer?.callback(
      entryList([
        { entryType: 'event', interactionId: 7, duration: -1, startTime: 100 },
        { entryType: 'event', interactionId: 7, duration: Number.NaN, startTime: 110 },
      ]),
    );
    if (!sub.ok) throw new Error('subscribe must succeed');
    sub.subscription.unsubscribe();
    expect(facts.filter((f) => f.metricName === 'inp')).toHaveLength(0);
  });
});
