/**
 * Stable public input and result contract for persisting one request event safe
 * sample. The caller-facing boundary accepts unknown and the repository
 * validates everything before touching the database. A sample is NOT a complete
 * request occurrence history: it stores only the protocol-validated safe
 * projection of a request event already selected by an upstream policy.
 */
export interface PersistRequestEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks the
 * RequestEventEnvelope body or input values.
 */
export type PersistRequestEventSampleResult =
  | {
      readonly status: 'inserted';
      readonly sampleId: string;
    }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from a RequestEventEnvelope
 * that already passed @aurora/event-schema root validation. Not exported.
 */
export interface RequestSampleDbParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly protocolVersion: number;
  readonly occurredAtIso: string;
  readonly sampleBody: unknown;
}
