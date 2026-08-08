/**
 * Stable public input and result contract for persisting one performance event
 * safe sample. The caller-facing boundary accepts unknown and the repository
 * validates everything before touching the database. A sample is a bounded
 * diagnostic projection of a performance event already selected by an upstream
 * policy, NOT a complete performance occurrence history.
 */
export interface PersistPerformanceEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks the
 * PerformanceEventEnvelope body or input values.
 */
export type PersistPerformanceEventSampleResult =
  | {
      readonly status: 'inserted';
      readonly sampleId: string;
    }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from a PerformanceEventEnvelope
 * that already passed @aurora/event-schema root validation. Not exported.
 */
export interface PerformanceSampleDbParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAtIso: string;
  readonly sampleBody: unknown;
}
