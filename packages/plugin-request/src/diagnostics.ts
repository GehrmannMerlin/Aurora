import type { BrowserRequestSourceEventType } from '@aurora/browser';

const MAX_DIAGNOSTICS = 100;

export const RequestCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  InvalidBrowserFact: 'invalid_browser_fact',
  UnsupportedMethod: 'unsupported_method',
  RequestBodyRejected: 'request_body_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type RequestCaptureDiagnosticCode =
  (typeof RequestCaptureDiagnosticCode)[keyof typeof RequestCaptureDiagnosticCode];

export const RequestCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type RequestCaptureDiagnosticOperation =
  (typeof RequestCaptureDiagnosticOperation)[keyof typeof RequestCaptureDiagnosticOperation];

export interface RequestCaptureDiagnostic {
  readonly sequence: number;
  readonly code: RequestCaptureDiagnosticCode;
  readonly operation: RequestCaptureDiagnosticOperation;
  readonly mechanism?: BrowserRequestSourceEventType;
}

export type RequestCaptureDiagnosticInput = Omit<RequestCaptureDiagnostic, 'sequence'>;

export interface RequestCaptureDiagnosticStore {
  append(input: RequestCaptureDiagnosticInput): void;
  snapshot(): readonly RequestCaptureDiagnostic[];
}

export function createRequestCaptureDiagnosticStore(): RequestCaptureDiagnosticStore {
  const entries: RequestCaptureDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: RequestCaptureDiagnosticInput): void {
      entries.push(Object.freeze({ sequence: nextSequence, ...input }));
      nextSequence += 1;
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    snapshot(): readonly RequestCaptureDiagnostic[] {
      return Object.freeze([...entries]);
    },
  });
}
