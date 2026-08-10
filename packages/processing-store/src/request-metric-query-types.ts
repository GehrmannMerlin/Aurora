import type { RequestMethod, RequestOutcome } from '@aurora/event-schema';

/**
 * Read-only query window over the request metric / sample stores. The window is
 * half-open: `[startIso, endIso)` applied to `bucket_start` (metric buckets) and
 * `occurred_at` (diagnostic samples). Both bounds are RFC 3339 UTC timestamps.
 */
export interface RequestMetricQueryWindow {
  readonly projectId: string;
  readonly startIso: string;
  readonly endIso: string;
}

/** One outcome dimension with its observed count within a method aggregate. */
export interface OutcomeAggregate {
  readonly outcome: RequestOutcome;
  readonly count: number;
}

/**
 * Aggregates for a single request method over the queried window, derived from
 * the complete `request_metric_buckets` store (no sampling extrapolation).
 * `outcomes` is the per-outcome observed count split of `observedCount`.
 */
export interface MethodAggregate {
  readonly method: RequestMethod;
  readonly observedCount: number;
  readonly failureCount: number;
  readonly slowCount: number;
  readonly durationSumMs: number;
  readonly durationMaxMs: number;
  readonly outcomes: OutcomeAggregate[];
}

/** Windowed summary over request metric buckets. */
export interface RequestMetricSummary {
  readonly methods: MethodAggregate[];
  /** Latest `updated_at` among queried buckets, or null when the window has no buckets. */
  readonly dataThrough: string | null;
}

/**
 * A normalized endpoint identity derived from bounded diagnostic samples. The
 * endpoint list is a partial view (`isPartial: true`) over the sampled subset,
 * never a complete endpoint enumeration: `completeness` records the bounded,
 * diagnostic-sample source.
 */
export interface RequestEndpointSummary {
  readonly endpointId: string;
  readonly method: RequestMethod;
  readonly url: string;
  readonly sampleCount: number;
  readonly outcomeCounts: OutcomeAggregate[];
  /** Latest `created_at` among the endpoint's samples in the window, or null. */
  readonly dataThrough: string | null;
  readonly isPartial: true;
  readonly completeness: {
    readonly source: 'diagnostic_samples';
    readonly bounded: true;
  };
}

/** One page of the endpoint keyset listing. */
export interface RequestEndpointPage {
  readonly items: RequestEndpointSummary[];
  /** Keyset cursor for the next page, or null when this is the last page. */
  readonly nextCursor: string | null;
  /** Distinct endpoint count in the whole window (not scoped to the page). */
  readonly totalCount: number;
}

/** Endpoint page query input: the window plus an optional cursor and page size. */
export interface RequestEndpointPageQuery extends RequestMetricQueryWindow {
  readonly cursor?: string;
  readonly limit: number;
}
