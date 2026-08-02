export const BrowserErrorSourceEventType = Object.freeze({
  JavaScript: 'javascript_error',
  UnhandledRejection: 'unhandled_rejection',
  Resource: 'resource_error',
} as const);
export type BrowserErrorSourceEventType =
  (typeof BrowserErrorSourceEventType)[keyof typeof BrowserErrorSourceEventType];

export interface BrowserJavaScriptErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.JavaScript;
  readonly message: string | null;
  readonly sourceUrl: string | null;
  readonly error: unknown;
}
export interface BrowserUnhandledRejectionSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.UnhandledRejection;
  readonly reason: unknown;
}
export interface BrowserResourceErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.Resource;
  readonly tagName: string | null;
  readonly sourceUrl: string | null;
  readonly rel: string | null;
  readonly as: string | null;
}
export type BrowserErrorSourceEvent =
  | BrowserJavaScriptErrorSourceEvent
  | BrowserUnhandledRejectionSourceEvent
  | BrowserResourceErrorSourceEvent;
export type BrowserErrorSourceListener = (event: BrowserErrorSourceEvent) => void;

// --- private view helpers ---

import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import { readProperty, sanitizePageUrl } from './safe-access.js';

type NativeErrorSourceType = 'error' | 'unhandledrejection';

function readValue(
  target: unknown,
  key: PropertyKey,
  eventType: BrowserErrorSourceEventType,
  diagnostics: BrowserDiagnosticStore,
): unknown {
  const result = readProperty(target, key);
  if (!result.ok && result.reason === 'threw')
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.ErrorSource,
      eventType,
    });
  return result.ok ? result.value : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function lowerString(value: unknown): string | null {
  const text = optionalString(value);
  return text === null ? null : text.toLowerCase();
}

function readSourceUrl(
  target: unknown,
  keys: readonly PropertyKey[],
  eventType: BrowserErrorSourceEventType,
  diagnostics: BrowserDiagnosticStore,
): string | null {
  for (const key of keys) {
    const sanitized = sanitizePageUrl(readValue(target, key, eventType, diagnostics));
    if (sanitized !== null) return sanitized;
  }
  return null;
}

function isResourceTarget(
  target: unknown,
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): boolean {
  if (target === undefined || target === null || target === host.windowTarget) return false;
  const tagName = readValue(target, 'tagName', BrowserErrorSourceEventType.Resource, diagnostics);
  return typeof tagName === 'string' && tagName.length > 0;
}

export function createErrorSourceEvent(
  nativeType: NativeErrorSourceType,
  nativeEvent: unknown,
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserErrorSourceEvent {
  if (nativeType === 'unhandledrejection')
    return Object.freeze({
      type: BrowserErrorSourceEventType.UnhandledRejection,
      reason: readValue(
        nativeEvent,
        'reason',
        BrowserErrorSourceEventType.UnhandledRejection,
        diagnostics,
      ),
    });

  const target = readValue(
    nativeEvent,
    'target',
    BrowserErrorSourceEventType.JavaScript,
    diagnostics,
  );
  if (isResourceTarget(target, host, diagnostics)) {
    const eventType = BrowserErrorSourceEventType.Resource;
    return Object.freeze({
      type: eventType,
      tagName: lowerString(readValue(target, 'tagName', eventType, diagnostics)),
      sourceUrl: readSourceUrl(target, ['currentSrc', 'src', 'href'], eventType, diagnostics),
      rel: lowerString(readValue(target, 'rel', eventType, diagnostics)),
      as: lowerString(readValue(target, 'as', eventType, diagnostics)),
    });
  }
  const eventType = BrowserErrorSourceEventType.JavaScript;
  return Object.freeze({
    type: eventType,
    message: optionalString(readValue(nativeEvent, 'message', eventType, diagnostics)),
    sourceUrl: sanitizePageUrl(readValue(nativeEvent, 'filename', eventType, diagnostics)),
    error: readValue(nativeEvent, 'error', eventType, diagnostics),
  });
}

// --- manager ---

import {
  BrowserDestroyCode,
  BrowserSubscribeCode,
  BrowserUnsubscribeCode,
  type BrowserDestroyResult,
  type BrowserSubscribeResult,
  type BrowserSubscription,
  type BrowserUnsubscribeResult,
} from './page-lifecycle.js';
import { callMethod, readMethod, type UnknownCallable } from './safe-access.js';

interface ErrorSourceRegistration {
  readonly type: 'error' | 'unhandledrejection';
  readonly listener: UnknownCallable;
  readonly capture: boolean;
  readonly remove: UnknownCallable;
}
interface ErrorSourceRecord {
  isActive: boolean;
  readonly registrations: ErrorSourceRegistration[];
}
export interface ErrorSourceManager {
  subscribe(listener: BrowserErrorSourceListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
}

export function createErrorSourceManager(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): ErrorSourceManager {
  const active = new Set<ErrorSourceRecord>();
  let isDestroyed = false;

  function notify(
    record: ErrorSourceRecord,
    listener: BrowserErrorSourceListener,
    nativeType: 'error' | 'unhandledrejection',
    nativeEvent: unknown,
  ): void {
    if (!record.isActive) return;
    const event = createErrorSourceEvent(nativeType, nativeEvent, host, diagnostics);
    try {
      listener(event);
    } catch {
      diagnostics.append({
        code: BrowserDiagnosticCode.CallbackFailed,
        operation: BrowserDiagnosticOperation.Notify,
        eventType: event.type,
      });
    }
  }

  function removeAll(
    record: ErrorSourceRecord,
    operation:
      typeof BrowserDiagnosticOperation.Unsubscribe | typeof BrowserDiagnosticOperation.Destroy,
  ): number {
    if (!record.isActive) return 0;
    record.isActive = false;
    active.delete(record);
    const before = diagnostics.getTotalCount();
    for (const registration of [...record.registrations].reverse()) {
      const removed = callMethod(registration.remove, host.windowTarget, [
        registration.type,
        registration.listener,
        registration.capture,
      ]);
      if (!removed.ok)
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRemovalFailed,
          operation,
          capability: BrowserCapabilityName.ErrorSource,
        });
    }
    return diagnostics.getTotalCount() - before;
  }

  function subscribe(listener: BrowserErrorSourceListener): BrowserSubscribeResult {
    if (typeof listener !== 'function')
      return Object.freeze({
        ok: false,
        code: BrowserSubscribeCode.InvalidListener,
        diagnosticsAdded: 0,
      });
    if (isDestroyed)
      return Object.freeze({
        ok: false,
        code: BrowserSubscribeCode.Destroyed,
        diagnosticsAdded: 0,
      });
    const add = readMethod(host.windowTarget, 'addEventListener');
    const remove = readMethod(host.windowTarget, 'removeEventListener');
    if (!add.ok || !remove.ok) {
      const before = diagnostics.getTotalCount();
      const hasThrown =
        (!add.ok && add.reason === 'threw') || (!remove.ok && remove.reason === 'threw');
      if (hasThrown)
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.ErrorSource,
        });
      return Object.freeze({
        ok: false,
        code: hasThrown
          ? BrowserSubscribeCode.ListenerRegistrationFailed
          : BrowserSubscribeCode.EnvironmentUnavailable,
        diagnosticsAdded: diagnostics.getTotalCount() - before,
      });
    }

    const record: ErrorSourceRecord = { isActive: true, registrations: [] };
    const requests = [
      {
        type: 'error' as const,
        capture: true,
        listener: (event: unknown): void => {
          notify(record, listener, 'error', event);
        },
      },
      {
        type: 'unhandledrejection' as const,
        capture: false,
        listener: (event: unknown): void => {
          notify(record, listener, 'unhandledrejection', event);
        },
      },
    ];
    for (const request of requests) {
      const added = callMethod(add.value, host.windowTarget, [
        request.type,
        request.listener,
        request.capture,
      ]);
      if (!added.ok) {
        const before = diagnostics.getTotalCount();
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.ErrorSource,
        });
        removeAll(record, BrowserDiagnosticOperation.Unsubscribe);
        return Object.freeze({
          ok: false,
          code: BrowserSubscribeCode.ListenerRegistrationFailed,
          diagnosticsAdded: diagnostics.getTotalCount() - before,
        });
      }
      record.registrations.push({ ...request, remove: remove.value });
    }
    active.add(record);
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe(): BrowserUnsubscribeResult {
        if (!record.isActive)
          return Object.freeze({
            ok: true,
            code: BrowserUnsubscribeCode.AlreadyUnsubscribed,
            diagnosticsAdded: 0,
          });
        return Object.freeze({
          ok: true,
          code: BrowserUnsubscribeCode.Unsubscribed,
          diagnosticsAdded: removeAll(record, BrowserDiagnosticOperation.Unsubscribe),
        });
      },
    });
    return Object.freeze({
      ok: true,
      code: BrowserSubscribeCode.Subscribed,
      subscription,
      diagnosticsAdded: 0,
    });
  }

  function destroy(): BrowserDestroyResult {
    const before = diagnostics.getTotalCount();
    if (isDestroyed)
      return Object.freeze({
        ok: true,
        code: BrowserDestroyCode.AlreadyDestroyed,
        diagnosticsAdded: 0,
      });
    isDestroyed = true;
    for (const record of [...active]) removeAll(record, BrowserDiagnosticOperation.Destroy);
    return Object.freeze({
      ok: true,
      code: BrowserDestroyCode.Destroyed,
      diagnosticsAdded: diagnostics.getTotalCount() - before,
    });
  }
  return Object.freeze({ subscribe, destroy });
}
