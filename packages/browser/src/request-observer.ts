import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import {
  createFetchRequestSourceEvent,
  createXhrRequestSourceEvent,
  BrowserRequestOutcome,
  type BrowserRequestSourceEvent,
  type BrowserRequestSourceListener,
} from './request-source.js';
import { callMethod, readProperty, readMethod } from './safe-access.js';

export interface RequestObserver {
  subscribe(listener: BrowserRequestSourceListener): boolean;
  unsubscribe(listener: BrowserRequestSourceListener): boolean;
  isInstalled(): boolean;
  destroy(): void;
}

function readMonotonicMilliseconds(host: BrowserHostContext): number {
  const now = readMethod(host.performanceTarget, 'now');
  if (!now.ok) return 0;
  const result = callMethod(now.value, host.performanceTarget, []);
  return result.ok && typeof result.value === 'number' && Number.isFinite(result.value)
    ? result.value
    : 0;
}

function readStatusCode(input: unknown): number | null {
  const status = readProperty(input, 'status');
  return status.ok && typeof status.value === 'number' && Number.isSafeInteger(status.value)
    ? status.value
    : null;
}

function readStringProperty(input: unknown, key: string): string | null {
  const value = readProperty(input, key);
  return value.ok && typeof value.value === 'string' ? value.value : null;
}

function isAbortError(reason: unknown): boolean {
  return readStringProperty(reason, 'name') === 'AbortError';
}

function safeAssign(target: unknown, key: string, value: unknown): boolean {
  if ((typeof target !== 'object' || target === null) && typeof target !== 'function') {
    return false;
  }
  try {
    return Reflect.set(target, key, value);
  } catch {
    return false;
  }
}

export function createRequestObserver(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): RequestObserver {
  const listeners = new Set<BrowserRequestSourceListener>();
  let installed = false;
  let fetchInstalled = false;
  let xhrInstalled = false;
  let capturedFetch: unknown;
  let capturedXhr: unknown;
  let wrappedFetchValue: unknown;
  let wrappedXhrValue: unknown;

  function notify(event: BrowserRequestSourceEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        diagnostics.append({
          code: BrowserDiagnosticCode.CallbackFailed,
          operation: BrowserDiagnosticOperation.Notify,
          capability: BrowserCapabilityName.RequestSource,
          eventType: event.mechanism,
        });
      }
    }
  }

  function install(): boolean {
    if (installed) return true;
    let anyWritten = false;
    const fetchRead = readProperty(host.windowTarget, 'fetch');
    const xhrRead = readProperty(host.windowTarget, 'XMLHttpRequest');
    for (const [result, name] of [
      [fetchRead, BrowserCapabilityName.RequestSource],
      [xhrRead, BrowserCapabilityName.RequestSource],
    ] as const) {
      if (!result.ok && result.reason === 'threw')
        diagnostics.append({
          code: BrowserDiagnosticCode.GlobalAccessFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: name,
        });
    }
    if (fetchRead.ok && typeof fetchRead.value === 'function') {
      const originalFetch = fetchRead.value;
      const wrapper = createFetchWrapper(originalFetch, host, notify);
      const written = safeAssign(host.windowTarget, 'fetch', wrapper);
      if (!written) {
        void safeAssign(host.windowTarget, 'fetch', originalFetch);
      } else {
        capturedFetch = originalFetch;
        wrappedFetchValue = wrapper;
        fetchInstalled = true;
        anyWritten = true;
      }
    }
    if (xhrRead.ok && typeof xhrRead.value === 'function') {
      const originalXhr = xhrRead.value;
      const wrapper = createXhrWrapper(originalXhr, host, notify);
      const written = safeAssign(host.windowTarget, 'XMLHttpRequest', wrapper);
      if (!written) {
        void safeAssign(host.windowTarget, 'XMLHttpRequest', originalXhr);
      } else {
        capturedXhr = originalXhr;
        wrappedXhrValue = wrapper;
        xhrInstalled = true;
        anyWritten = true;
      }
    }
    if (!anyWritten) return false;
    installed = true;
    return true;
  }

  function restoreFetch(): void {
    if (!fetchInstalled) return;
    fetchInstalled = false;
    const currentFetch = readProperty(host.windowTarget, 'fetch');
    if (currentFetch.ok && currentFetch.value === wrappedFetchValue) {
      void safeAssign(host.windowTarget, 'fetch', capturedFetch);
    }
    capturedFetch = undefined;
    wrappedFetchValue = undefined;
  }

  function restoreXhr(): void {
    if (!xhrInstalled) return;
    xhrInstalled = false;
    const currentXhr = readProperty(host.windowTarget, 'XMLHttpRequest');
    if (currentXhr.ok && currentXhr.value === wrappedXhrValue) {
      void safeAssign(host.windowTarget, 'XMLHttpRequest', capturedXhr);
    }
    capturedXhr = undefined;
    wrappedXhrValue = undefined;
  }

  function restore(): void {
    if (!installed) return;
    installed = false;
    restoreFetch();
    restoreXhr();
  }

  function subscribe(listener: BrowserRequestSourceListener): boolean {
    if (typeof listener !== 'function') return false;
    if (listeners.has(listener)) return true;
    if (listeners.size === 0 && !installed && !install()) return false;
    listeners.add(listener);
    return true;
  }

  function unsubscribe(listener: BrowserRequestSourceListener): boolean {
    if (!listeners.has(listener)) return false;
    listeners.delete(listener);
    if (listeners.size === 0) restore();
    return true;
  }

  function destroy(): void {
    listeners.clear();
    restore();
  }

  return Object.freeze({ subscribe, unsubscribe, isInstalled: (): boolean => installed, destroy });
}

function createFetchWrapper(
  originalFetch: unknown,
  host: BrowserHostContext,
  notify: (event: BrowserRequestSourceEvent) => void,
): unknown {
  const wrapper = function wrappedFetch(this: unknown, ...args: unknown[]): unknown {
    const startedMonotonic = readMonotonicMilliseconds(host);
    const promise = Reflect.apply(
      originalFetch as (...args: unknown[]) => Promise<unknown>,
      this,
      args,
    );
    promise.then(
      (response: unknown) => {
        const statusCode = readStatusCode(response);
        const outcome =
          statusCode !== null && statusCode >= 400
            ? BrowserRequestOutcome.HttpError
            : BrowserRequestOutcome.Success;
        const endedMonotonic = readMonotonicMilliseconds(host);
        const event = createFetchRequestSourceEvent(
          args[0],
          args[1],
          Date.now(),
          Math.max(0, endedMonotonic - startedMonotonic),
          outcome,
          statusCode,
        );
        if (event !== null) notify(event);
      },
      (reason: unknown) => {
        const outcome = isAbortError(reason)
          ? BrowserRequestOutcome.Canceled
          : BrowserRequestOutcome.NetworkError;
        const endedMonotonic = readMonotonicMilliseconds(host);
        const event = createFetchRequestSourceEvent(
          args[0],
          args[1],
          Date.now(),
          Math.max(0, endedMonotonic - startedMonotonic),
          outcome,
          null,
        );
        if (event !== null) notify(event);
      },
    );
    return promise;
  };
  return wrapper;
}

function createXhrWrapper(
  originalXhr: unknown,
  host: BrowserHostContext,
  notify: (event: BrowserRequestSourceEvent) => void,
): unknown {
  const XhrNative = originalXhr as new () => unknown;

  const wrapper = function wrappedXhr(this: unknown): unknown {
    const instance: object = Reflect.construct(XhrNative, []) as object;
    const nativeOpen = readMethod(instance, 'open');
    const nativeSend = readMethod(instance, 'send');
    const nativeAbort = readMethod(instance, 'abort');
    const nativeAddListener = readMethod(instance, 'addEventListener');
    const nativeRemoveListener = readMethod(instance, 'removeEventListener');
    if (
      !nativeOpen.ok ||
      !nativeSend.ok ||
      !nativeAbort.ok ||
      !nativeAddListener.ok ||
      !nativeRemoveListener.ok
    ) {
      return instance;
    }
    const openMethod = nativeOpen.value;
    const sendMethod = nativeSend.value;
    const abortMethod = nativeAbort.value;
    const addListenerMethod = nativeAddListener.value;
    const removeListenerMethod = nativeRemoveListener.value;
    let method: string | null = null;
    let urlInput: unknown = null;
    let startedMonotonic = 0;
    let finished = false;
    const internalListeners: { type: string; handler: (...args: unknown[]) => void }[] = [];

    function cleanupInternalListeners(): void {
      for (const entry of internalListeners) {
        try {
          void Reflect.apply(removeListenerMethod, instance, [entry.type, entry.handler]);
        } catch {
          // internal cleanup must never affect the host request
        }
      }
      internalListeners.length = 0;
    }

    function finish(outcome: BrowserRequestOutcome, statusCode: number | null): void {
      if (finished) return;
      finished = true;
      cleanupInternalListeners();
      const endedMonotonic = readMonotonicMilliseconds(host);
      const event = createXhrRequestSourceEvent(
        method,
        urlInput,
        Date.now(),
        Math.max(0, endedMonotonic - startedMonotonic),
        outcome,
        statusCode,
      );
      if (event !== null) notify(event);
    }

    const wrappedOpen = function wrappedOpen(this: unknown, ...openArgs: unknown[]): unknown {
      const targetMethod = typeof openArgs[0] === 'string' ? openArgs[0] : null;
      method = targetMethod;
      urlInput = openArgs[1];
      return Reflect.apply(openMethod, instance, openArgs);
    };
    const wrappedSend = function wrappedSend(this: unknown, ...sendArgs: unknown[]): unknown {
      cleanupInternalListeners();
      finished = false;
      startedMonotonic = readMonotonicMilliseconds(host);
      const handlers: readonly [string, BrowserRequestOutcome][] = [
        ['load', BrowserRequestOutcome.Success],
        ['error', BrowserRequestOutcome.NetworkError],
        ['abort', BrowserRequestOutcome.Canceled],
        ['timeout', BrowserRequestOutcome.Timeout],
      ];
      for (const [type, outcome] of handlers) {
        const handler = (): void => {
          const statusCode =
            outcome === BrowserRequestOutcome.Success ? readStatusCode(instance) : null;
          const resolvedOutcome =
            outcome === BrowserRequestOutcome.Success && statusCode !== null && statusCode >= 400
              ? BrowserRequestOutcome.HttpError
              : outcome;
          finish(resolvedOutcome, statusCode);
        };
        try {
          void Reflect.apply(addListenerMethod, instance, [type, handler]);
          internalListeners.push({ type, handler });
        } catch {
          // a failed internal registration must not affect the host send
        }
      }
      return Reflect.apply(sendMethod, instance, sendArgs);
    };
    const wrappedAbort = function wrappedAbort(this: unknown, ...abortArgs: unknown[]): unknown {
      return Reflect.apply(abortMethod, instance, abortArgs);
    };

    // Patch only this instance's own methods; the native instance is returned so
    // instanceof, on* handlers, addEventListener, and internal event dispatch all
    // behave natively. XMLHttpRequest.prototype is never modified.
    void Reflect.set(instance, 'open', wrappedOpen);
    void Reflect.set(instance, 'send', wrappedSend);
    void Reflect.set(instance, 'abort', wrappedAbort);
    return instance;
  };

  return wrapper;
}
