import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import { readVisibilityState, type PageVisibilityState } from './page-snapshot.js';
import { callMethod, readMethod, readProperty, type UnknownCallable } from './safe-access.js';

export const PageLifecycleEventType = Object.freeze({
  VisibilityChange: 'visibility_change',
  PageHide: 'page_hide',
  PageShow: 'page_show',
} as const);
export type PageLifecycleEventType =
  (typeof PageLifecycleEventType)[keyof typeof PageLifecycleEventType];
export interface VisibilityChangeLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.VisibilityChange;
  readonly visibilityState: PageVisibilityState;
}
export interface PageHideLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageHide;
  readonly isPersisted: boolean | null;
}
export interface PageShowLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageShow;
  readonly isPersisted: boolean | null;
}
export type PageLifecycleEvent =
  VisibilityChangeLifecycleEvent | PageHideLifecycleEvent | PageShowLifecycleEvent;
export type BrowserLifecycleListener = (event: PageLifecycleEvent) => void;

export const BrowserSubscribeCode = Object.freeze({
  Subscribed: 'subscribed',
  InvalidListener: 'invalid_listener',
  EnvironmentUnavailable: 'environment_unavailable',
  Destroyed: 'destroyed',
  ListenerRegistrationFailed: 'listener_registration_failed',
} as const);
export type BrowserSubscribeFailureCode =
  | typeof BrowserSubscribeCode.InvalidListener
  | typeof BrowserSubscribeCode.EnvironmentUnavailable
  | typeof BrowserSubscribeCode.Destroyed
  | typeof BrowserSubscribeCode.ListenerRegistrationFailed;
export interface BrowserSubscribeSuccess {
  readonly ok: true;
  readonly code: typeof BrowserSubscribeCode.Subscribed;
  readonly subscription: BrowserSubscription;
  readonly diagnosticsAdded: number;
}
export interface BrowserSubscribeFailure {
  readonly ok: false;
  readonly code: BrowserSubscribeFailureCode;
  readonly diagnosticsAdded: number;
}
export type BrowserSubscribeResult = BrowserSubscribeSuccess | BrowserSubscribeFailure;
export const BrowserUnsubscribeCode = Object.freeze({
  Unsubscribed: 'unsubscribed',
  AlreadyUnsubscribed: 'already_unsubscribed',
} as const);
export interface BrowserUnsubscribeResult {
  readonly ok: true;
  readonly code:
    typeof BrowserUnsubscribeCode.Unsubscribed | typeof BrowserUnsubscribeCode.AlreadyUnsubscribed;
  readonly diagnosticsAdded: number;
}
export interface BrowserSubscription {
  unsubscribe(): BrowserUnsubscribeResult;
}
export const BrowserDestroyCode = Object.freeze({
  Destroyed: 'destroyed',
  AlreadyDestroyed: 'already_destroyed',
} as const);
export interface BrowserDestroyResult {
  readonly ok: true;
  readonly code: typeof BrowserDestroyCode.Destroyed | typeof BrowserDestroyCode.AlreadyDestroyed;
  readonly diagnosticsAdded: number;
}
interface Registration {
  readonly target: unknown;
  readonly type: string;
  readonly listener: UnknownCallable;
  readonly remove: UnknownCallable;
}
interface SubscriptionRecord {
  isActive: boolean;
  readonly registrations: Registration[];
}
export interface LifecycleManager {
  subscribe(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
}

function persisted(
  event: unknown,
  diagnostics: BrowserDiagnosticStore,
  eventType: PageLifecycleEventType,
): boolean | null {
  const result = readProperty(event, 'persisted');
  if (!result.ok && result.reason === 'threw')
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PageLifecycle,
      eventType,
    });
  return result.ok && typeof result.value === 'boolean' ? result.value : null;
}

export function createLifecycleManager(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): LifecycleManager {
  const active = new Set<SubscriptionRecord>();
  let isDestroyed = false;

  function notify(
    record: SubscriptionRecord,
    listener: BrowserLifecycleListener,
    event: PageLifecycleEvent,
  ): void {
    if (!record.isActive) return;
    try {
      listener(Object.freeze(event));
    } catch {
      diagnostics.append({
        code: BrowserDiagnosticCode.CallbackFailed,
        operation: BrowserDiagnosticOperation.Notify,
        eventType: event.type,
      });
    }
  }

  function removeAll(
    record: SubscriptionRecord,
    operation:
      typeof BrowserDiagnosticOperation.Unsubscribe | typeof BrowserDiagnosticOperation.Destroy,
  ): number {
    if (!record.isActive) return 0;
    record.isActive = false;
    active.delete(record);
    const before = diagnostics.getTotalCount();
    for (const registration of [...record.registrations].reverse()) {
      const result = callMethod(registration.remove, registration.target, [
        registration.type,
        registration.listener,
      ]);
      if (!result.ok)
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRemovalFailed,
          operation,
          capability: BrowserCapabilityName.PageLifecycle,
        });
    }
    return diagnostics.getTotalCount() - before;
  }

  function subscribe(listener: BrowserLifecycleListener): BrowserSubscribeResult {
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
    const record: SubscriptionRecord = { isActive: true, registrations: [] };
    const visibilityListener = (): void => {
      if (!record.isActive) return;
      notify(record, listener, {
        type: PageLifecycleEventType.VisibilityChange,
        visibilityState: readVisibilityState(
          host.documentTarget,
          diagnostics,
          BrowserDiagnosticOperation.Notify,
        ),
      });
    };
    const hideListener = (event: unknown): void => {
      if (!record.isActive) return;
      notify(record, listener, {
        type: PageLifecycleEventType.PageHide,
        isPersisted: persisted(event, diagnostics, PageLifecycleEventType.PageHide),
      });
    };
    const showListener = (event: unknown): void => {
      if (!record.isActive) return;
      notify(record, listener, {
        type: PageLifecycleEventType.PageShow,
        isPersisted: persisted(event, diagnostics, PageLifecycleEventType.PageShow),
      });
    };
    const requests = [
      { target: host.documentTarget, type: 'visibilitychange', listener: visibilityListener },
      { target: host.windowTarget, type: 'pagehide', listener: hideListener },
      { target: host.windowTarget, type: 'pageshow', listener: showListener },
    ];
    for (const request of requests) {
      const add = readMethod(request.target, 'addEventListener');
      const remove = readMethod(request.target, 'removeEventListener');
      if (!add.ok || !remove.ok) {
        const before = diagnostics.getTotalCount();
        const hasThrown =
          (!add.ok && add.reason === 'threw') || (!remove.ok && remove.reason === 'threw');
        if (hasThrown)
          diagnostics.append({
            code: BrowserDiagnosticCode.ListenerRegistrationFailed,
            operation: BrowserDiagnosticOperation.Subscribe,
            capability: BrowserCapabilityName.PageLifecycle,
          });
        removeAll(record, BrowserDiagnosticOperation.Unsubscribe);
        return Object.freeze({
          ok: false,
          code: hasThrown
            ? BrowserSubscribeCode.ListenerRegistrationFailed
            : BrowserSubscribeCode.EnvironmentUnavailable,
          diagnosticsAdded: diagnostics.getTotalCount() - before,
        });
      }
      const before = diagnostics.getTotalCount();
      const added = callMethod(add.value, request.target, [request.type, request.listener]);
      if (!added.ok) {
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.PageLifecycle,
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
    if (isDestroyed)
      return Object.freeze({
        ok: true,
        code: BrowserDestroyCode.AlreadyDestroyed,
        diagnosticsAdded: 0,
      });
    isDestroyed = true;
    const before = diagnostics.getTotalCount();
    for (const record of [...active]) removeAll(record, BrowserDiagnosticOperation.Destroy);
    return Object.freeze({
      ok: true,
      code: BrowserDestroyCode.Destroyed,
      diagnosticsAdded: diagnostics.getTotalCount() - before,
    });
  }
  return Object.freeze({ subscribe, destroy });
}
