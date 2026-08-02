import type { BrowserErrorSourceListener, BrowserSubscription } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createErrorCapturePlugin } from '../src/index.js';

describe('error plugin host safety', () => {
  it('contains conversion and submit exceptions and handles the next event', () => {
    let listener: BrowserErrorSourceListener | undefined;
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
      subscribeRequests: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribePerformance: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeErrorSources(next: BrowserErrorSourceListener) {
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
    const plugin = createErrorCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    expect(() =>
      listener?.({
        type: 'javascript_error',
        message: 'first',
        sourceUrl: null,
        error: new Error('first'),
      }),
    ).not.toThrow();
    listener?.({ type: 'unhandled_rejection', reason: 'second' });
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('private');
  });

  it('does not access a raw rejection again after the synchronous callback', () => {
    let listener: BrowserErrorSourceListener | undefined;
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeRequests: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribePerformance: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeErrorSources(next: BrowserErrorSourceListener) {
        listener = next;
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => ({
              ok: true as const,
              code: 'unsubscribed' as const,
              diagnosticsAdded: 0 as const,
            }),
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const target = { code: 7 };
    const revocable = Proxy.revocable(target, {});
    const plugin = createErrorCapturePlugin(browser);
    plugin.initialize(
      Object.freeze({
        submitEvent: () => ({
          ok: true as const,
          code: 'accepted' as const,
          state: 'started' as const,
          diagnosticsAdded: 0 as const,
        }),
      }),
    );
    plugin.start();
    listener?.({ type: 'unhandled_rejection', reason: revocable.proxy });
    revocable.revoke();
    expect(() => {
      plugin.stop();
      plugin.start();
      plugin.destroy();
      plugin.getDiagnostics();
    }).not.toThrow();
  });
});
