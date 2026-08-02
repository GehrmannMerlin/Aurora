import type { BrowserRequestSourceListener } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCapturePlugin } from '../src/index.js';

function sharedBrowser() {
  const active = new Set<BrowserRequestSourceListener>();
  return {
    active,
    browser: {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribePerformance: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests(listener: BrowserRequestSourceListener) {
        active.add(listener);
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
              active.delete(listener);
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
    dispatch(): void {
      const fact = {
        mechanism: 'fetch' as const,
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1800000005000,
        durationMs: 120,
        outcome: 'success' as const,
        statusCode: 200,
      };
      for (const listener of [...active]) listener(fact);
    },
  };
}

function context(submitEvent: CorePluginContext['submitEvent']): CorePluginContext {
  return Object.freeze({ submitEvent });
}

describe('request plugin multi-instance isolation', () => {
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
    const first = createRequestCapturePlugin(fixture.browser);
    const second = createRequestCapturePlugin(fixture.browser);
    first.initialize(context(firstSubmit));
    second.initialize(context(secondSubmit));
    first.start();
    second.start();
    fixture.dispatch();
    first.destroy();
    fixture.dispatch();
    expect(firstSubmit).toHaveBeenCalledTimes(1);
    expect(secondSubmit).toHaveBeenCalledTimes(2);
    expect(fixture.active.size).toBe(1);
    second.destroy();
    expect(fixture.active.size).toBe(0);
  });

  it('keeps diagnostics and submit failures instance-local', () => {
    const fixture = sharedBrowser();
    const failed = createRequestCapturePlugin(fixture.browser);
    const healthy = createRequestCapturePlugin(fixture.browser);
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
    fixture.dispatch();
    expect(failed.getDiagnostics()).toHaveLength(1);
    expect(healthy.getDiagnostics()).toEqual([]);
    expect(failed.getDiagnostics()[0]?.sequence).toBe(1);
  });

  it('never calls BrowserEnvironment.destroy and leaves other subscribers intact', () => {
    const fixture = sharedBrowser();
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(
      context(() => ({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      })),
    );
    plugin.start();
    fixture.dispatch();
    plugin.destroy();
    fixture.dispatch();
    expect(fixture.browser.destroy).not.toHaveBeenCalled();
    expect(fixture.active.size).toBe(0);
  });
});
