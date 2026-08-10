/**
 * Stable public input and result contract for persisting one error event
 * occurrence. The caller-facing boundary accepts unknown and the repository
 * validates everything before touching the database.
 */
export interface PersistErrorEventOccurrenceInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
  /**
   * Optional fingerprint computed by the error processor (DAT-12 §11). When
   * absent, the store computes it internally via `computeErrorFingerprint` so
   * the NOT NULL column is always populated and legacy callers keep working.
   */
  readonly fingerprint?: string;
  readonly fingerprintVersion?: number;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks the
 * EventEnvelope body or input values.
 */
export type PersistErrorEventOccurrenceResult =
  | {
      readonly status: 'inserted';
      readonly occurrenceId: string;
    }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from an ErrorEventEnvelope
 * that already passed @aurora/event-schema root validation. Not exported.
 */
export interface ErrorOccurrenceDbParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly protocolVersion: number;
  readonly occurredAtIso: string;
  readonly errorCategory: string;
  readonly normalizedBody: unknown;
  readonly fingerprint: string;
  readonly fingerprintVersion: number;
}
