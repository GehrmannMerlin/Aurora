import type { ErrorEventBody } from '@aurora/event-schema';

/**
 * Stable public input and result contract for the error normalization /
 * fingerprint algorithm (DAT-12 spec §4). The caller must pass an ErrorEventBody
 * that already passed `parseErrorEventEnvelope` validation; the algorithm never
 * re-interprets the protocol.
 */
export const ERROR_FINGERPRINT_VERSION = 1 as const;

export interface ErrorFingerprintInput {
  readonly projectId: string;
  readonly body: ErrorEventBody;
}

export interface ErrorFingerprintResult {
  /** Stable, versioned grouping key. Deterministic: same input -> same value. */
  readonly fingerprint: string;
  readonly fingerprintVersion: number;
  /** Safe bounded projection of the normalized message, for C3/C4 titles. */
  readonly normalizedTitle: string;
}
