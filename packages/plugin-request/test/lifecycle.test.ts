import {
  type BrowserEnvironment,
  type BrowserRequestSourceEvent,
  type BrowserRequestSourceListener,
  type BrowserSubscription,
} from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCapturePlugin } from '../src/index.js';

function createBrowserDouble(options: { readonly subscriptionFails?: boolean } = {}): {
  readonly browser: BrowserEnvironment;
  readonly listeners: BrowserRequestSourceListener[];
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
} {
  const listeners: BrowserRequestSourceListener[] = [];
  const unsubscribe = vi.fn(() => ({
    ok: true as const,
    code: 'unsubscribed' as const,
    diagnosticsAdded: 0,
  }));
  const destroy = vi.fn(() => ({
    ok: true as const,
    code: 'destroyed' as const,
    diagnosticsAdded: 0,
  }));
  const subscription: BrowserSubscription = Object.freeze({ unsubscribe });
  return {
    listeners,
    unsubscribe,
    destroy,
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
      subscribeRequests: vi.fn((listener: BrowserRequestSourceListener) => {
        if (options.subscriptionFails === true) {
          return {
            ok: false as const,
            code: 'listener_registration_failed' as const,
            diagnosticsAdded: 1,
          };
        }
        listeners.push(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          subscription,
          diagnosticsAdded: 0,
        };
      }),
      destroy,
      getDiagnostics: vi.fn(() => []),
    },
  };
}

const context: CorePluginContext = Object.freeze({
  submitEvent: vi.fn(() => ({
    ok: true as const,
    code: 'accepted' as const,
    state: 'started' as const,
    diagnosticsAdded: 0 as const,
  })),
});

function requestFact(
  overrides: Partial<BrowserRequestSourceEvent> = {},
): BrowserRequestSourceEvent {
  return {
    mechanism: 'fetch' as const,
    method: 'GET',
    url: 'https://api.example.test/orders',
    startedAt: 1800000005000,
    durationMs: 120,
    outcome: 'success' as const,
    statusCode: 200,
    ...overrides,
  };
}

describe('request capture lifecycle', () => {
  it('subscribes once, stops once, restarts, and destroys without owning Browser', () => {
    const fixture = createBrowserDouble();
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(context);
    plugin.initialize(context);
    plugin.start();
    plugin.start();
    expect(fixture.listeners).toHaveLength(1);
    plugin.stop();
    plugin.stop();
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
    plugin.start();
    expect(fixture.listeners).toHaveLength(2);
    plugin.destroy();
    plugin.destroy();
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(2);
    expect(fixture.destroy).not.toHaveBeenCalled();
  });

  it('records failed subscription and allows a later retry', () => {
    const fixture = createBrowserDouble({ subscriptionFails: true });
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(context);
    expect(() => {
      plugin.start();
    }).not.toThrow();
    expect(plugin.getDiagnostics()).toEqual([
      { sequence: 1, code: 'browser_subscription_failed', operation: 'start' },
    ]);
    plugin.stop();
    plugin.start();
    expect(plugin.getDiagnostics()).toHaveLength(2);
  });

  it('never restarts after destroy and returns immutable diagnostic copies', () => {
    const fixture = createBrowserDouble();
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.start();
    plugin.destroy();
    plugin.initialize(context);
    plugin.start();
    const diagnostics = plugin.getDiagnostics();
    expect(diagnostics.map(({ code }) => code)).toEqual([
      'invalid_lifecycle_call',
      'invalid_lifecycle_call',
      'invalid_lifecycle_call',
    ]);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(diagnostics.every(Object.isFrozen)).toBe(true);
  });

  it('ignores retained host callbacks after stop and after destroy', () => {
    const fixture = createBrowserDouble();
    const submitEvent = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    const retained = fixture.listeners[0];
    if (retained === undefined) throw new Error('listener must exist');
    plugin.stop();
    retained(requestFact());
    plugin.start();
    plugin.destroy();
    retained(requestFact());
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it('deactivates before an unsubscribe exception and records no sensitive text', () => {
    const listeners: BrowserRequestSourceListener[] = [];
    const browser = {
      ...createBrowserDouble().browser,
      subscribeRequests(listener: BrowserRequestSourceListener) {
        listeners.push(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe(): never {
              throw new Error('token=removal-private');
            },
          }),
        };
      },
    };
    const submitEvent = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const plugin = createRequestCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    plugin.stop();
    listeners[0]?.(requestFact());
    expect(submitEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('private');
    expect(plugin.getDiagnostics()).toMatchObject([
      { code: 'browser_unsubscribe_failed', operation: 'stop' },
    ]);
  });
});
