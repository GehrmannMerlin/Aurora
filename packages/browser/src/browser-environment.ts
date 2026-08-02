import {
  captureBrowserHost,
  detectBrowserCapabilities,
  type BrowserCapabilities,
} from './capabilities.js';
import { createDiagnosticStore, type BrowserDiagnostic } from './diagnostics.js';
import { createErrorSourceManager, type BrowserErrorSourceListener } from './error-source.js';
import {
  BrowserDestroyCode,
  createLifecycleManager,
  type BrowserDestroyResult,
  type BrowserLifecycleListener,
  type BrowserSubscribeResult,
} from './page-lifecycle.js';
import { readPageSnapshot, type BrowserPageSnapshot } from './page-snapshot.js';
import { createRequestObserver, type RequestObserver } from './request-observer.js';
import type { BrowserRequestSourceListener } from './request-source.js';
import {
  createPerformanceObserverManager,
  type PerformanceObserverManager,
} from './performance-source.js';
import type { BrowserPerformanceSourceListener } from './performance-source-types.js';

export interface BrowserEnvironment {
  getCapabilities(): BrowserCapabilities;
  readPageSnapshot(): BrowserPageSnapshot;
  subscribePageLifecycle(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  subscribeErrorSources(listener: BrowserErrorSourceListener): BrowserSubscribeResult;
  subscribeRequests(listener: BrowserRequestSourceListener): BrowserSubscribeResult;
  subscribePerformance(listener: BrowserPerformanceSourceListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
  getDiagnostics(): readonly BrowserDiagnostic[];
}

export function createBrowserEnvironment(): BrowserEnvironment {
  const diagnostics = createDiagnosticStore();
  const host = captureBrowserHost(diagnostics);
  const capabilities = detectBrowserCapabilities(host, diagnostics);
  const lifecycle = createLifecycleManager(host, diagnostics);
  const errorSources = createErrorSourceManager(host, diagnostics);
  const requestSources: RequestObserver = createRequestObserver(host, diagnostics);
  const performanceSource: PerformanceObserverManager = createPerformanceObserverManager(
    host,
    diagnostics,
  );
  let isDestroyed = false;

  function destroy(): BrowserDestroyResult {
    if (isDestroyed)
      return Object.freeze({
        ok: true,
        code: BrowserDestroyCode.AlreadyDestroyed,
        diagnosticsAdded: 0,
      });
    isDestroyed = true;
    const before = diagnostics.getTotalCount();
    errorSources.destroy();
    lifecycle.destroy();
    requestSources.destroy();
    performanceSource.destroy();
    return Object.freeze({
      ok: true,
      code: BrowserDestroyCode.Destroyed,
      diagnosticsAdded: diagnostics.getTotalCount() - before,
    });
  }

  return Object.freeze({
    getCapabilities: (): BrowserCapabilities => capabilities,
    readPageSnapshot: (): BrowserPageSnapshot => readPageSnapshot(host, diagnostics),
    subscribePageLifecycle: (listener: BrowserLifecycleListener): BrowserSubscribeResult =>
      lifecycle.subscribe(listener),
    subscribeErrorSources: (listener: BrowserErrorSourceListener): BrowserSubscribeResult =>
      errorSources.subscribe(listener),
    subscribeRequests: (listener: BrowserRequestSourceListener): BrowserSubscribeResult => {
      if (isDestroyed)
        return Object.freeze({
          ok: false,
          code: 'destroyed' as const,
          diagnosticsAdded: 0,
        });
      if (typeof listener !== 'function')
        return Object.freeze({
          ok: false,
          code: 'invalid_listener' as const,
          diagnosticsAdded: 0,
        });
      return requestSources.subscribe(listener)
        ? Object.freeze({
            ok: true,
            code: 'subscribed' as const,
            subscription: Object.freeze({
              unsubscribe: () =>
                requestSources.unsubscribe(listener)
                  ? Object.freeze({
                      ok: true,
                      code: 'unsubscribed' as const,
                      diagnosticsAdded: 0,
                    })
                  : Object.freeze({
                      ok: true,
                      code: 'already_unsubscribed' as const,
                      diagnosticsAdded: 0,
                    }),
            }),
            diagnosticsAdded: 0,
          })
        : Object.freeze({
            ok: false,
            code: 'environment_unavailable' as const,
            diagnosticsAdded: 0,
          });
    },
    subscribePerformance: (listener: BrowserPerformanceSourceListener): BrowserSubscribeResult => {
      if (isDestroyed)
        return Object.freeze({
          ok: false,
          code: 'destroyed' as const,
          diagnosticsAdded: 0,
        });
      if (typeof listener !== 'function')
        return Object.freeze({
          ok: false,
          code: 'invalid_listener' as const,
          diagnosticsAdded: 0,
        });
      if (!capabilities.canObservePerformance)
        return Object.freeze({
          ok: false,
          code: 'environment_unavailable' as const,
          diagnosticsAdded: 0,
        });
      return performanceSource.subscribe(listener);
    },
    destroy,
    getDiagnostics: (): readonly BrowserDiagnostic[] => diagnostics.getDiagnostics(),
  });
}
