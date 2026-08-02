import type { BrowserPerformanceMetricName } from '@aurora/browser';

const MAX_DIAGNOSTICS = 100;

export const PerformanceCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  PerformanceFactInvalid: 'performance_fact_invalid',
  PerformanceSchemaRejected: 'performance_schema_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type PerformanceCaptureDiagnosticCode =
  (typeof PerformanceCaptureDiagnosticCode)[keyof typeof PerformanceCaptureDiagnosticCode];

export const PerformanceCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type PerformanceCaptureDiagnosticOperation =
  (typeof PerformanceCaptureDiagnosticOperation)[keyof typeof PerformanceCaptureDiagnosticOperation];

export interface PerformanceCaptureDiagnostic {
  readonly sequence: number;
  readonly code: PerformanceCaptureDiagnosticCode;
  readonly operation: PerformanceCaptureDiagnosticOperation;
  readonly metricName?: BrowserPerformanceMetricName;
}

export type PerformanceCaptureDiagnosticInput = Omit<PerformanceCaptureDiagnostic, 'sequence'>;

export interface PerformanceCaptureDiagnosticStore {
  append(input: PerformanceCaptureDiagnosticInput): void;
  snapshot(): readonly PerformanceCaptureDiagnostic[];
}

export function createPerformanceCaptureDiagnosticStore(): PerformanceCaptureDiagnosticStore {
  const entries: PerformanceCaptureDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: PerformanceCaptureDiagnosticInput): void {
      entries.push(Object.freeze({ sequence: nextSequence, ...input }));
      nextSequence += 1;
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    snapshot(): readonly PerformanceCaptureDiagnostic[] {
      return Object.freeze([...entries]);
    },
  });
}
