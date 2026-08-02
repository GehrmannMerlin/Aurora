import type { BrowserRequestSourceListener, BrowserSubscription } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCapturePlugin } from '../src/index.js';

describe('request plugin host safety', () => {
  it('contains conversion and submit exceptions and handles the next event', () => {
    let listener: BrowserRequestSourceListener | undefined;
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe: () => ({
        ok: true as const,
        code: 'unsubscribed' as const,
        diagnosticsAdded: 0 as const,
      }),
    });
    const browser = {
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
      subscribeRequests(next: BrowserRequestSourceListener) {
        listener = next;
        return {
          ok: true as const,
          code: 'subscribed' as const,
          subscription,
          diagnosticsAdded: 0,
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockImplementationOnce(() => {
        throw new Error('authorization=private');
      })
      .mockReturnValueOnce({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      });
    const plugin = createRequestCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    const fact = {
      mechanism: 'fetch' as const,
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: 'success' as const,
      statusCode: 200,
    };
    listener?.(fact);
    listener?.(fact);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('authorization');
    expect(plugin.getDiagnostics()).toMatchObject([
      { code: 'internal_error', operation: 'notify', mechanism: 'fetch' },
    ]);
  });

  it('does not mutate the host request fact', () => {
    const listeners: BrowserRequestSourceListener[] = [];
    const browser = {
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
      subscribeRequests(next: BrowserRequestSourceListener) {
        listeners.push(next);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => ({
              ok: true as const,
              code: 'unsubscribed' as const,
              diagnosticsAdded: 0,
            }),
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
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
    const fact = {
      mechanism: 'fetch' as const,
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: 'success' as const,
      statusCode: 200,
    };
    const snapshot = JSON.stringify(fact);
    listeners[0]?.(fact);
    expect(JSON.stringify(fact)).toBe(snapshot);
    expect(submitEvent).toHaveBeenCalledTimes(1);
  });
});
