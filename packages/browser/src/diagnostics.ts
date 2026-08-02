import type { BrowserCapabilityName } from './capabilities.js';
import type { BrowserErrorSourceEventType } from './error-source.js';
import type { PageLifecycleEventType } from './page-lifecycle.js';
import type { BrowserRequestSourceEventType } from './request-source.js';
import type { BrowserPerformanceMetricName } from './performance-source-types.js';

const MAX_DIAGNOSTICS = 100;
export const BrowserDiagnosticCode = Object.freeze({
  GlobalAccessFailed: 'global_access_failed',
  PropertyReadFailed: 'property_read_failed',
  ClockReadFailed: 'clock_read_failed',
  ListenerRegistrationFailed: 'listener_registration_failed',
  ListenerRemovalFailed: 'listener_removal_failed',
  CallbackFailed: 'callback_failed',
  PerformanceEntryRejected: 'performance_entry_rejected',
} as const);
export type BrowserDiagnosticCode =
  (typeof BrowserDiagnosticCode)[keyof typeof BrowserDiagnosticCode];
export const BrowserDiagnosticOperation = Object.freeze({
  Create: 'create',
  ReadCapabilities: 'read_capabilities',
  ReadSnapshot: 'read_snapshot',
  Subscribe: 'subscribe',
  Unsubscribe: 'unsubscribe',
  Destroy: 'destroy',
  Notify: 'notify',
} as const);
export type BrowserDiagnosticOperation =
  (typeof BrowserDiagnosticOperation)[keyof typeof BrowserDiagnosticOperation];
export type BrowserDiagnosticEventType =
  | PageLifecycleEventType
  | BrowserErrorSourceEventType
  | BrowserRequestSourceEventType
  | BrowserPerformanceMetricName;
export interface BrowserDiagnostic {
  readonly sequence: number;
  readonly code: BrowserDiagnosticCode;
  readonly operation: BrowserDiagnosticOperation;
  readonly capability?: BrowserCapabilityName;
  readonly eventType?: BrowserDiagnosticEventType;
}
export interface BrowserDiagnosticInput {
  readonly code: BrowserDiagnosticCode;
  readonly operation: BrowserDiagnosticOperation;
  readonly capability?: BrowserCapabilityName;
  readonly eventType?: BrowserDiagnosticEventType;
}
export interface BrowserDiagnosticStore {
  append(input: BrowserDiagnosticInput): void;
  getDiagnostics(): readonly BrowserDiagnostic[];
  getTotalCount(): number;
}

export function createDiagnosticStore(): BrowserDiagnosticStore {
  const entries: BrowserDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: BrowserDiagnosticInput): void {
      const entry: BrowserDiagnostic = Object.freeze({ sequence: nextSequence, ...input });
      nextSequence += 1;
      entries.push(entry);
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    getDiagnostics(): readonly BrowserDiagnostic[] {
      return Object.freeze([...entries]);
    },
    getTotalCount(): number {
      return nextSequence - 1;
    },
  });
}
