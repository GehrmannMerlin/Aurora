import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import { callMethod, readMethod, readProperty, sanitizePageUrl } from './safe-access.js';

export const PageVisibilityState = Object.freeze({
  Visible: 'visible',
  Hidden: 'hidden',
  Unknown: 'unknown',
} as const);
export type PageVisibilityState = (typeof PageVisibilityState)[keyof typeof PageVisibilityState];
export interface BrowserClockSnapshot {
  readonly unixMilliseconds: number | null;
  readonly monotonicMilliseconds: number | null;
}
export interface BrowserPageSnapshot {
  readonly pageUrl: string | null;
  readonly userAgent: string | null;
  readonly visibilityState: PageVisibilityState;
  readonly clock: BrowserClockSnapshot;
}

function reportPropertyFailure(
  hasThrown: boolean,
  capability:
    | typeof BrowserCapabilityName.PageUrl
    | typeof BrowserCapabilityName.UserAgent
    | typeof BrowserCapabilityName.Visibility,
  diagnostics: BrowserDiagnosticStore,
  operation:
    typeof BrowserDiagnosticOperation.ReadSnapshot | typeof BrowserDiagnosticOperation.Notify,
): void {
  if (hasThrown)
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation,
      capability,
    });
}

function readPageUrl(host: BrowserHostContext, diagnostics: BrowserDiagnosticStore): string | null {
  const location = readProperty(host.windowTarget, 'location');
  const href = location.ok ? readProperty(location.value, 'href') : location;
  reportPropertyFailure(
    !href.ok && href.reason === 'threw',
    BrowserCapabilityName.PageUrl,
    diagnostics,
    BrowserDiagnosticOperation.ReadSnapshot,
  );
  if (!href.ok) return null;
  const sanitized = sanitizePageUrl(href.value);
  if (sanitized === null && typeof href.value === 'string' && href.value.length > 0) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.ReadSnapshot,
      capability: BrowserCapabilityName.PageUrl,
    });
  }
  return sanitized;
}

function readUserAgent(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): string | null {
  const result = readProperty(host.navigatorTarget, 'userAgent');
  reportPropertyFailure(
    !result.ok && result.reason === 'threw',
    BrowserCapabilityName.UserAgent,
    diagnostics,
    BrowserDiagnosticOperation.ReadSnapshot,
  );
  return result.ok && typeof result.value === 'string' && result.value.length > 0
    ? result.value
    : null;
}

export function readVisibilityState(
  documentTarget: unknown,
  diagnostics: BrowserDiagnosticStore,
  operation:
    typeof BrowserDiagnosticOperation.ReadSnapshot | typeof BrowserDiagnosticOperation.Notify,
): PageVisibilityState {
  const result = readProperty(documentTarget, 'visibilityState');
  reportPropertyFailure(
    !result.ok && result.reason === 'threw',
    BrowserCapabilityName.Visibility,
    diagnostics,
    operation,
  );
  if (!result.ok) return PageVisibilityState.Unknown;
  if (result.value === 'visible') return PageVisibilityState.Visible;
  if (result.value === 'hidden') return PageVisibilityState.Hidden;
  return PageVisibilityState.Unknown;
}

function readUnixMilliseconds(diagnostics: BrowserDiagnosticStore): number | null {
  try {
    const value = Date.now();
    if (Number.isSafeInteger(value)) return value;
  } catch {
    /* represented below */
  }
  diagnostics.append({
    code: BrowserDiagnosticCode.ClockReadFailed,
    operation: BrowserDiagnosticOperation.ReadSnapshot,
  });
  return null;
}

function readMonotonicMilliseconds(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): number | null {
  const method = readMethod(host.performanceTarget, 'now');
  if (!method.ok) {
    if (method.reason === 'threw')
      diagnostics.append({
        code: BrowserDiagnosticCode.ClockReadFailed,
        operation: BrowserDiagnosticOperation.ReadSnapshot,
        capability: BrowserCapabilityName.Performance,
      });
    return null;
  }
  const result = callMethod(method.value, host.performanceTarget, []);
  if (
    result.ok &&
    typeof result.value === 'number' &&
    Number.isFinite(result.value) &&
    result.value >= 0
  )
    return result.value;
  diagnostics.append({
    code: BrowserDiagnosticCode.ClockReadFailed,
    operation: BrowserDiagnosticOperation.ReadSnapshot,
    capability: BrowserCapabilityName.Performance,
  });
  return null;
}

export function readPageSnapshot(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserPageSnapshot {
  const clock: BrowserClockSnapshot = Object.freeze({
    unixMilliseconds: readUnixMilliseconds(diagnostics),
    monotonicMilliseconds: readMonotonicMilliseconds(host, diagnostics),
  });
  return Object.freeze({
    pageUrl: readPageUrl(host, diagnostics),
    userAgent: readUserAgent(host, diagnostics),
    visibilityState: readVisibilityState(
      host.documentTarget,
      diagnostics,
      BrowserDiagnosticOperation.ReadSnapshot,
    ),
    clock,
  });
}
