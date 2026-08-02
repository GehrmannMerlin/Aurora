import type {
  BrowserEnvironment,
  BrowserRequestSourceEvent,
  BrowserRequestSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createRequestCaptureDiagnosticStore,
  RequestCaptureDiagnosticCode,
  RequestCaptureDiagnosticOperation,
  type RequestCaptureDiagnostic,
} from './diagnostics.js';
import { createRequestSourceHandler, type RequestSourceHandler } from './request-source-handler.js';

export const REQUEST_CAPTURE_PLUGIN_NAME = 'request-capture' as const;

export interface RequestCapturePlugin extends CorePlugin {
  readonly name: typeof REQUEST_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly RequestCaptureDiagnostic[];
}

export function createRequestCapturePlugin(browser: BrowserEnvironment): RequestCapturePlugin {
  const diagnostics = createRequestCaptureDiagnosticStore();
  let handler: RequestSourceHandler | undefined;
  let subscription: BrowserSubscription | undefined;
  let isAcceptingEvents = false;
  let isDestroyed = false;

  const listener: BrowserRequestSourceListener = (event: BrowserRequestSourceEvent): void => {
    if (!isAcceptingEvents) return;
    handler?.handle(event);
  };

  function initialize(context: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: RequestCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (handler !== undefined) return;
    try {
      const submitEvent = context.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.InvalidPluginContext,
          operation: RequestCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      handler = createRequestSourceHandler(submitEvent, diagnostics);
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InvalidPluginContext,
        operation: RequestCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || handler === undefined) {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: RequestCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    try {
      const result = browser.subscribeRequests(listener);
      if (!result.ok) {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: RequestCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
      isAcceptingEvents = true;
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: RequestCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      | typeof RequestCaptureDiagnosticOperation.Stop
      | typeof RequestCaptureDiagnosticOperation.Destroy,
  ): void {
    isAcceptingEvents = false;
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(RequestCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(RequestCaptureDiagnosticOperation.Destroy);
    handler = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: REQUEST_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly RequestCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
