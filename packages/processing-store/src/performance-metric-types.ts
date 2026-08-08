import type { PerformanceMetricName, PerformanceMetricUnit } from '@aurora/event-schema';

/**
 * A performance metric contribution submitted by a future Performance Processor.
 * The store validates the shape but does NOT classify goodness/exceedance;
 * percentile, histogram, and exceed-rate are explicitly out of scope.
 */
export interface PerformanceMetricContributionInput {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly metricName: PerformanceMetricName;
  readonly unit: PerformanceMetricUnit;
  readonly value: number;
  readonly startedAt: number;
  readonly durationMs?: number;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks metric
 * values or input details.
 */
export type PersistPerformanceMetricContributionResult =
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from a performance metric
 * contribution. Not exported.
 */
export interface PerformanceMetricBucketParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly bucketStartIso: string;
  readonly metricName: string;
  readonly unit: string;
  readonly value: number;
  readonly durationMs?: number;
}
