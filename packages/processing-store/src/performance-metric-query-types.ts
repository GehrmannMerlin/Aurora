import type { PerformanceMetricName, PerformanceMetricUnit } from '@aurora/event-schema';

/**
 * Read-only query window over the performance metric bucket store. The window is
 * half-open: `[startIso, endIso)` applied to `bucket_start`. Both bounds are
 * RFC 3339 UTC timestamps.
 */
export interface PerformanceMetricQueryWindow {
  readonly projectId: string;
  readonly startIso: string;
  readonly endIso: string;
}

/**
 * Project-level aggregate for one performance metric over the queried window,
 * derived from the complete `performance_metric_buckets` store (no sampling
 * extrapolation). `mean` is `valueSum / observedCount` and is only present when
 * `observedCount > 0` (zero-observed rows are never returned).
 */
export interface MetricAggregate {
  readonly metricName: PerformanceMetricName;
  readonly unit: PerformanceMetricUnit;
  readonly observedCount: number;
  readonly valueSum: number;
  readonly valueMax: number;
  readonly mean: number;
}

/** Windowed summary over performance metric buckets. */
export interface PerformanceMetricSummary {
  readonly metrics: MetricAggregate[];
  /** Latest `updated_at` among queried buckets, or null when the window has no buckets. */
  readonly dataThrough: string | null;
}
