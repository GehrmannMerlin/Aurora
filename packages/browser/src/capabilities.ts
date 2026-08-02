import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import { isObjectLike, readMethod, readProperty, sanitizePageUrl } from './safe-access.js';

export const BrowserCapabilityName = Object.freeze({
  Window: 'window',
  Document: 'document',
  Navigator: 'navigator',
  Performance: 'performance',
  PageUrl: 'page_url',
  UserAgent: 'user_agent',
  Visibility: 'visibility',
  PageLifecycle: 'page_lifecycle',
  ErrorSource: 'error_source',
  RequestSource: 'request_source',
  PerformanceSource: 'performance_source',
} as const);
export type BrowserCapabilityName =
  (typeof BrowserCapabilityName)[keyof typeof BrowserCapabilityName];
export interface BrowserCapabilities {
  readonly isBrowserEnvironment: boolean;
  readonly hasWindow: boolean;
  readonly hasDocument: boolean;
  readonly hasNavigator: boolean;
  readonly hasPerformance: boolean;
  readonly canReadPageUrl: boolean;
  readonly canReadUserAgent: boolean;
  readonly canReadVisibility: boolean;
  readonly canObservePageLifecycle: boolean;
  readonly canObserveErrorSources: boolean;
  readonly canObserveRequests: boolean;
  readonly canObservePerformance: boolean;
}
export interface BrowserHostContext {
  readonly windowTarget: unknown;
  readonly documentTarget: unknown;
  readonly navigatorTarget: unknown;
  readonly performanceTarget: unknown;
}

function readGlobal(
  key: 'window' | 'document' | 'navigator' | 'performance',
  capability: BrowserCapabilityName,
  diagnostics: BrowserDiagnosticStore,
): unknown {
  const result = readProperty(globalThis, key);
  if (!result.ok && result.reason === 'threw')
    diagnostics.append({
      code: BrowserDiagnosticCode.GlobalAccessFailed,
      operation: BrowserDiagnosticOperation.Create,
      capability,
    });
  return result.ok ? result.value : undefined;
}

export function captureBrowserHost(diagnostics: BrowserDiagnosticStore): BrowserHostContext {
  return Object.freeze({
    windowTarget: readGlobal('window', BrowserCapabilityName.Window, diagnostics),
    documentTarget: readGlobal('document', BrowserCapabilityName.Document, diagnostics),
    navigatorTarget: readGlobal('navigator', BrowserCapabilityName.Navigator, diagnostics),
    performanceTarget: readGlobal('performance', BrowserCapabilityName.Performance, diagnostics),
  });
}

function hasListenerPair(
  target: unknown,
  diagnostics: BrowserDiagnosticStore,
  capability:
    | typeof BrowserCapabilityName.PageLifecycle
    | typeof BrowserCapabilityName.ErrorSource
    | typeof BrowserCapabilityName.RequestSource,
): boolean {
  const add = readMethod(target, 'addEventListener');
  const remove = readMethod(target, 'removeEventListener');
  for (const result of [add, remove]) {
    if (!result.ok && result.reason === 'threw')
      diagnostics.append({
        code: BrowserDiagnosticCode.PropertyReadFailed,
        operation: BrowserDiagnosticOperation.ReadCapabilities,
        capability,
      });
  }
  return add.ok && remove.ok;
}

function canObserveRequests(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): boolean {
  const fetchMethod = readMethod(host.windowTarget, 'fetch');
  const xhr = readProperty(host.windowTarget, 'XMLHttpRequest');
  for (const [result, name] of [
    [fetchMethod, BrowserCapabilityName.RequestSource],
    [xhr, BrowserCapabilityName.RequestSource],
  ] as const) {
    if (!result.ok && result.reason === 'threw')
      diagnostics.append({
        code: BrowserDiagnosticCode.PropertyReadFailed,
        operation: BrowserDiagnosticOperation.ReadCapabilities,
        capability: name,
      });
  }
  return (
    fetchMethod.ok &&
    xhr.ok &&
    typeof xhr.value === 'function' &&
    typeof (xhr.value as { prototype?: unknown }).prototype === 'object'
  );
}

function canObservePerformance(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): boolean {
  const getEntriesByType = readMethod(host.performanceTarget, 'getEntriesByType');
  const getEntries = readMethod(host.performanceTarget, 'getEntries');
  const perfObserver = readProperty(host.windowTarget, 'PerformanceObserver');
  for (const [result, name] of [
    [getEntriesByType, BrowserCapabilityName.PerformanceSource],
    [getEntries, BrowserCapabilityName.PerformanceSource],
    [perfObserver, BrowserCapabilityName.PerformanceSource],
  ] as const) {
    if (!result.ok && result.reason === 'threw')
      diagnostics.append({
        code: BrowserDiagnosticCode.PropertyReadFailed,
        operation: BrowserDiagnosticOperation.ReadCapabilities,
        capability: name,
      });
  }
  return (
    isObjectLike(host.performanceTarget) &&
    getEntriesByType.ok &&
    getEntries.ok &&
    perfObserver.ok &&
    typeof perfObserver.value === 'function'
  );
}

export function detectBrowserCapabilities(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserCapabilities {
  const location = readProperty(host.windowTarget, 'location');
  const href = location.ok ? readProperty(location.value, 'href') : location;
  const userAgent = readProperty(host.navigatorTarget, 'userAgent');
  const visibility = readProperty(host.documentTarget, 'visibilityState');
  for (const [result, capability] of [
    [href, BrowserCapabilityName.PageUrl],
    [userAgent, BrowserCapabilityName.UserAgent],
    [visibility, BrowserCapabilityName.Visibility],
  ] as const) {
    if (!result.ok && result.reason === 'threw')
      diagnostics.append({
        code: BrowserDiagnosticCode.PropertyReadFailed,
        operation: BrowserDiagnosticOperation.ReadCapabilities,
        capability,
      });
  }
  const hasWindow = isObjectLike(host.windowTarget);
  const hasDocument = isObjectLike(host.documentTarget);
  const hasNavigator = isObjectLike(host.navigatorTarget);
  const hasPerformance = isObjectLike(host.performanceTarget);
  return Object.freeze({
    isBrowserEnvironment: hasWindow && hasDocument,
    hasWindow,
    hasDocument,
    hasNavigator,
    hasPerformance,
    canReadPageUrl: href.ok && sanitizePageUrl(href.value) !== null,
    canReadUserAgent:
      userAgent.ok && typeof userAgent.value === 'string' && userAgent.value.length > 0,
    canReadVisibility: visibility.ok && typeof visibility.value === 'string',
    canObservePageLifecycle:
      hasListenerPair(host.windowTarget, diagnostics, BrowserCapabilityName.PageLifecycle) &&
      hasListenerPair(host.documentTarget, diagnostics, BrowserCapabilityName.PageLifecycle),
    canObserveErrorSources: hasListenerPair(
      host.windowTarget,
      diagnostics,
      BrowserCapabilityName.ErrorSource,
    ),
    canObserveRequests: canObserveRequests(host, diagnostics),
    canObservePerformance: canObservePerformance(host, diagnostics),
  });
}
