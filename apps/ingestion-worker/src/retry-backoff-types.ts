/** Explicit backoff configuration. No production defaults; callers always pass values. */
export interface RetryBackoffConfig {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
}

/** Injectable entropy source returning a finite value in [0, 1). */
export interface RetryBackoffEntropyProvider {
  next(): number;
}

/**
 * Discriminable result of a retry backoff calculation. Success carries the
 * computed delay, the resulting availableAt, and the capped delay. Failures are
 * stable statuses; the function never throws for normal control flow.
 */
export type RetryBackoffResult =
  | {
      readonly status: 'success';
      readonly delayMs: number;
      readonly availableAt: Date;
      readonly cappedDelayMs: number;
    }
  | { readonly status: 'invalid_config' }
  | { readonly status: 'invalid_attempt_count' }
  | { readonly status: 'invalid_now' }
  | { readonly status: 'invalid_not_before' }
  | { readonly status: 'invalid_entropy' }
  | { readonly status: 'date_out_of_range' };
