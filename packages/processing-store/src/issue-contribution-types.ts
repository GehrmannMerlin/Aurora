/**
 * Stable public input and result contract for contributing one fingerprinted
 * error event to the Issue aggregate (DAT-13 spec §5.1 / accepted ADR-033
 * decision details 3/5/5b). The caller passes the DAT-12 fingerprint output;
 * the repository validates everything before touching the database.
 */

/** Bounded representative-sample cap per issue (PRD §9.3.2; service-side config). */
export const DEFAULT_MAX_ISSUE_SAMPLES = 100 as const;

export interface PersistIssueContributionInput {
  readonly projectId: string;
  /** DAT-12 computeErrorFingerprint.fingerprint (the Issue group key). */
  readonly fingerprint: string;
  readonly fingerprintVersion: number;
  /** event-schema ErrorCategory constant ('javascript'|'unhandled_rejection'|'resource'). */
  readonly category: string;
  /** DAT-12 normalizedTitle (safe bounded projection, never raw message). */
  readonly normalizedTitle: string;
  readonly eventId: string;
  /** Envelope occurredAt, RFC 3339. */
  readonly occurredAtIso: string;
  /** Validated error body safe projection for the representative sample. */
  readonly sampleBody: unknown;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks the
 * sample body or input values.
 */
export type PersistIssueContributionResult =
  | { readonly status: 'inserted'; readonly issueId: string }
  | { readonly status: 'applied' }
  | { readonly status: 'reopened'; readonly issueId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };
