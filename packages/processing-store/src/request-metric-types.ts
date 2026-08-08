import type { RequestMethod, RequestOutcome } from '@aurora/event-schema';

/**
 * A request metric contribution submitted by a future Request Processor.
 * The store validates the shape but does NOT classify failure/slow: isFailure
 * and isSlow are produced by the Processor according to approved product rules.
 */
export interface RequestMetricContributionInput {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly method: RequestMethod;
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly isFailure: boolean;
  readonly isSlow: boolean;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks request
 * details or input values.
 */
export type PersistRequestMetricContributionResult =
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from a request metric
 * contribution. Not exported.
 */
export interface RequestMetricBucketParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly bucketStartIso: string;
  readonly method: string;
  readonly outcome: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly isFailure: boolean;
  readonly isSlow: boolean;
}
