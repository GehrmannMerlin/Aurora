import type {
  BrowserEnvironment,
  BrowserErrorSourceEvent,
  BrowserErrorSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createErrorCaptureDiagnosticStore,
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  type ErrorCaptureDiagnostic,
} from './diagnostics.js';
import { createErrorSourceHandler, type ErrorSourceHandler } from './source-event-handler.js';

export const ERROR_CAPTURE_PLUGIN_NAME = 'error-capture' as const;

export interface ErrorCapturePlugin extends CorePlugin {
  readonly name: typeof ERROR_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin {
  const diagnostics = createErrorCaptureDiagnosticStore();
  let handler: ErrorSourceHandler | undefined;
  let subscription: BrowserSubscription | undefined;
  let isAcceptingEvents = false;
  let isDestroyed = false;

  const listener: BrowserErrorSourceListener = (event: BrowserErrorSourceEvent): void => {
    if (!isAcceptingEvents) return;
    handler?.handle(event);
  };

  function initialize(context: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: ErrorCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (handler !== undefined) return;
    try {
      const submitEvent = context.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.InvalidPluginContext,
          operation: ErrorCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      handler = createErrorSourceHandler(submitEvent, diagnostics);
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidPluginContext,
        operation: ErrorCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || handler === undefined) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: ErrorCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    try {
      const result = browser.subscribeErrorSources(listener);
      if (!result.ok) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: ErrorCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
      isAcceptingEvents = true;
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: ErrorCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      typeof ErrorCaptureDiagnosticOperation.Stop | typeof ErrorCaptureDiagnosticOperation.Destroy,
  ): void {
    isAcceptingEvents = false;
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(ErrorCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(ErrorCaptureDiagnosticOperation.Destroy);
    handler = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: ERROR_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly ErrorCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
