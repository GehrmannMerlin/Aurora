import { IngestionReceiptState } from '@aurora/event-schema';

export interface SdkRetryDecision {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

const RETRYABLE_HTTP_STATUS: Readonly<Record<number, boolean>> = Object.freeze({
  408: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true,
});

function withRetryAfter(retryable: boolean, retryAfterMs?: number): SdkRetryDecision {
  if (!retryable || retryAfterMs === undefined || !Number.isSafeInteger(retryAfterMs) || retryAfterMs <= 0) {
    return Object.freeze({ retryable });
  }
  return Object.freeze({ retryable, retryAfterMs });
}

/**
 * PRD §6.3 / Batch-Receipt Contract §6: HTTP 400/401/403/413/415 are permanent
 * (invalid payload, credential, origin, environment, size); HTTP 408/429/5xx are
 * retryable. HTTP 0 means "transport not configured" (permanent config issue).
 */
export function classifySdkHttpStatus(status: number, retryAfterMs?: number): SdkRetryDecision {
  return withRetryAfter(RETRYABLE_HTTP_STATUS[status] === true, retryAfterMs);
}

/**
 * Receipt-level classification: permanently_rejected never retries;
 * temporarily_failed retries (honoring server retryAfterMs). accepted and
 * duplicate_accepted are terminal successes (no retry needed).
 */
export function classifySdkReceiptState(
  state: IngestionReceiptState,
  retryAfterMs?: number,
): SdkRetryDecision {
  if (state === IngestionReceiptState.TemporarilyFailed) {
    return withRetryAfter(true, retryAfterMs);
  }
  return Object.freeze({ retryable: false });
}

/** PRD §6.3: network failure and request timeout are retryable. */
export function classifySdkTransportReason(
  reason: 'network' | 'timeout',
  retryAfterMs?: number,
): SdkRetryDecision {
  void reason;
  return withRetryAfter(true, retryAfterMs);
}
