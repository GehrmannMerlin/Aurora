export interface CheckIngestionAdmissionInput {
  readonly requestId: string;
}

export type CheckIngestionAdmissionResult =
  | { readonly status: 'allow' }
  | { readonly status: 'temporarilyRejected'; readonly retryAfterMs: number };

/**
 * Minimal request admission port, reserved for 429. The first increment does
 * not implement a real rate limiter, Redis counters, or a quota system; the
 * production start path must still require an explicit implementation.
 */
export interface IngestionAdmissionPolicy {
  check(input: CheckIngestionAdmissionInput): Promise<CheckIngestionAdmissionResult>;
}

/** Explicit allow-all implementation for tests and explicit configuration. */
export const allowAllIngestionAdmissionPolicy: IngestionAdmissionPolicy = {
  check: (): Promise<CheckIngestionAdmissionResult> => Promise.resolve({ status: 'allow' }),
};
