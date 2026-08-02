import type {
  BrowserEnvironment,
  BrowserPerformanceSourceEvent,
  BrowserPerformanceSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createPerformanceCaptureDiagnosticStore,
  PerformanceCaptureDiagnosticCode,
  PerformanceCaptureDiagnosticOperation,
  type PerformanceCaptureDiagnostic,
} from './diagnostics.js';
import {
  createPerformanceSourceHandler,
  type PerformanceSourceHandler,
} from './performance-source-handler.js';

export const PERFORMANCE_CAPTURE_PLUGIN_NAME = 'performance-capture' as const;

export interface PerformanceCapturePlugin extends CorePlugin {
  readonly name: typeof PERFORMANCE_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly PerformanceCaptureDiagnostic[];
}

export function createPerformanceCapturePlugin(
  browser: BrowserEnvironment,
): PerformanceCapturePlugin {
  const diagnostics = createPerformanceCaptureDiagnosticStore();
  let handler: PerformanceSourceHandler | undefined;
  let subscription: BrowserSubscription | undefined;
  let isAcceptingEvents = false;
  let isDestroyed = false;

  const listener: BrowserPerformanceSourceListener = (
    event: BrowserPerformanceSourceEvent,
  ): void => {
    if (!isAcceptingEvents) return;
    handler?.handle(event);
  };

  function initialize(context: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: PerformanceCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (handler !== undefined) return;
    try {
      const submitEvent = context.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.InvalidPluginContext,
          operation: PerformanceCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    } catch {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InvalidPluginContext,
        operation: PerformanceCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || handler === undefined) {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: PerformanceCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    // 性能源在订阅返回前同步发送 page_load 事实，因此先启用接收再订阅；
    // 订阅失败时回退为不接收。
    isAcceptingEvents = true;
    try {
      const result = browser.subscribePerformance(listener);
      if (!result.ok) {
        isAcceptingEvents = false;
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: PerformanceCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
    } catch {
      isAcceptingEvents = false;
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: PerformanceCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      | typeof PerformanceCaptureDiagnosticOperation.Stop
      | typeof PerformanceCaptureDiagnosticOperation.Destroy,
  ): void {
    isAcceptingEvents = false;
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(PerformanceCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(PerformanceCaptureDiagnosticOperation.Destroy);
    handler = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: PERFORMANCE_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly PerformanceCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
