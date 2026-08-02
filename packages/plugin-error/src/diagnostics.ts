import type { BrowserErrorSourceEventType } from '@aurora/browser';

const MAX_DIAGNOSTICS = 100;

export const ErrorCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  UnsupportedSource: 'unsupported_source',
  ErrorBodyRejected: 'error_body_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type ErrorCaptureDiagnosticCode =
  (typeof ErrorCaptureDiagnosticCode)[keyof typeof ErrorCaptureDiagnosticCode];

export const ErrorCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type ErrorCaptureDiagnosticOperation =
  (typeof ErrorCaptureDiagnosticOperation)[keyof typeof ErrorCaptureDiagnosticOperation];

export interface ErrorCaptureDiagnostic {
  readonly sequence: number;
  readonly code: ErrorCaptureDiagnosticCode;
  readonly operation: ErrorCaptureDiagnosticOperation;
  readonly sourceType?: BrowserErrorSourceEventType;
}

export type ErrorCaptureDiagnosticInput = Omit<ErrorCaptureDiagnostic, 'sequence'>;

export interface ErrorCaptureDiagnosticStore {
  append(input: ErrorCaptureDiagnosticInput): void;
  snapshot(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCaptureDiagnosticStore(): ErrorCaptureDiagnosticStore {
  const entries: ErrorCaptureDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: ErrorCaptureDiagnosticInput): void {
      entries.push(Object.freeze({ sequence: nextSequence, ...input }));
      nextSequence += 1;
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    snapshot(): readonly ErrorCaptureDiagnostic[] {
      return Object.freeze([...entries]);
    },
  });
}
