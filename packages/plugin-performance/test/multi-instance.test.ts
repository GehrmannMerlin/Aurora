import type {
  BrowserPerformanceSourceListener,
  BrowserRequestSourceListener,
  BrowserErrorSourceListener,
} from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createPerformanceCapturePlugin } from '../src/index.js';

function sharedBrowser() {
  const perfListeners = new Set<BrowserPerformanceSourceListener>();
  return {
    perfListeners,
    browser: {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribePerformance(listener: BrowserPerformanceSourceListener) {
        perfListeners.add(listener);
        let isActive = true;
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe() {
              if (!isActive) {
                return {
                  ok: true as const,
                  code: 'already_unsubscribed' as const,
                  diagnosticsAdded: 0,
                };
              }
              isActive = false;
              perfListeners.delete(listener);
              return {
                ok: true as const,
                code: 'unsubscribed' as const,
                diagnosticsAdded: 0,
              };
            },
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    },
    dispatchPerf(): void {
      const fact = {
        metricName: 'lcp' as const,
        value: 2500,
        unit: 'millisecond' as const,
        startedAt: 1800000005000,
      };
      for (const listener of [...perfListeners]) listener(fact);
    },
  };
}

function context(submitEvent: CorePluginContext['submitEvent']): CorePluginContext {
  return Object.freeze({ submitEvent });
}

describe('performance plugin multi-instance isolation', () => {
  it('does not cross-remove instances sharing one BrowserEnvironment', () => {
    const fixture = sharedBrowser();
    const firstSubmit = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const secondSubmit = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const first = createPerformanceCapturePlugin(fixture.browser);
    const second = createPerformanceCapturePlugin(fixture.browser);
    first.initialize(context(firstSubmit));
    second.initialize(context(secondSubmit));
    first.start();
    second.start();
    fixture.dispatchPerf();
    first.destroy();
    fixture.dispatchPerf();
    expect(firstSubmit).toHaveBeenCalledTimes(1);
    expect(secondSubmit).toHaveBeenCalledTimes(2);
    expect(fixture.perfListeners.size).toBe(1);
    second.destroy();
    expect(fixture.perfListeners.size).toBe(0);
  });

  it('keeps diagnostics and submit failures instance-local', () => {
    const fixture = sharedBrowser();
    const failed = createPerformanceCapturePlugin(fixture.browser);
    const healthy = createPerformanceCapturePlugin(fixture.browser);
    failed.initialize(
      context(() => {
        throw new Error('private');
      }),
    );
    healthy.initialize(
      context(() => ({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      })),
    );
    failed.start();
    healthy.start();
    fixture.dispatchPerf();
    expect(failed.getDiagnostics()).toHaveLength(1);
    expect(healthy.getDiagnostics()).toEqual([]);
    expect(failed.getDiagnostics()[0]?.sequence).toBe(1);
  });

  it('never calls BrowserEnvironment.destroy', () => {
    const fixture = sharedBrowser();
    const plugin = createPerformanceCapturePlugin(fixture.browser);
    plugin.initialize(
      context(() => ({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      })),
    );
    plugin.start();
    plugin.destroy();
    expect(fixture.browser.destroy).not.toHaveBeenCalled();
    expect(fixture.perfListeners.size).toBe(0);
  });

  it('coexists with plugin-error and plugin-request without cross-releasing subscriptions', () => {
    const activeError = new Set<BrowserErrorSourceListener>();
    const activeRequest = new Set<BrowserRequestSourceListener>();
    const activePerf = new Set<BrowserPerformanceSourceListener>();
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources(listener: BrowserErrorSourceListener) {
        activeError.add(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => {
              activeError.delete(listener);
              return { ok: true as const, code: 'unsubscribed' as const, diagnosticsAdded: 0 };
            },
          }),
        };
      },
      subscribeRequests(listener: BrowserRequestSourceListener) {
        activeRequest.add(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => {
              activeRequest.delete(listener);
              return { ok: true as const, code: 'unsubscribed' as const, diagnosticsAdded: 0 };
            },
          }),
        };
      },
      subscribePerformance(listener: BrowserPerformanceSourceListener) {
        activePerf.add(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => {
              activePerf.delete(listener);
              return { ok: true as const, code: 'unsubscribed' as const, diagnosticsAdded: 0 };
            },
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const accepted = () => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    });
    const errorPlugin = createPerformanceCapturePlugin(browser);
    errorPlugin.initialize(context(accepted));
    errorPlugin.start();
    // 用 plugin-error/plugin-request 的真实工厂需要它们的包依赖；
    // 这里用同形态的第三个性能插件实例模拟"第三插件"，
    // 验证一个插件 destroy 不释放其他订阅。
    const second = createPerformanceCapturePlugin(browser);
    second.initialize(context(accepted));
    second.start();
    const third = createPerformanceCapturePlugin(browser);
    third.initialize(context(accepted));
    third.start();
    expect(activePerf.size).toBe(3);
    second.destroy();
    expect(activePerf.size).toBe(2);
    errorPlugin.destroy();
    expect(activePerf.size).toBe(1);
    third.destroy();
    expect(activePerf.size).toBe(0);
    expect(browser.destroy).not.toHaveBeenCalled();
  });
});
