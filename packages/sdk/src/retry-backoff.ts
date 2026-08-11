export interface SdkBackoffParams {
  readonly attemptCount: number; // 0-based attempts already made
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly entropy: number; // 0..1 jitter (injected for determinism)
  readonly serverRetryAfterMs?: number;
}

/**
 * Bounded retry delay. Honors a server-provided retryAfterMs (capped at
 * maxDelayMs); otherwise capped exponential backoff with equal jitter, so a
 * retry never exceeds maxDelayMs (PRD §6.1 / ADR-004: retry and backoff have
 * upper bounds).
 */
export function calculateSdkRetryDelay(params: SdkBackoffParams): number {
  const maxDelay = Math.max(1, Math.floor(params.maxDelayMs));
  if (
    params.serverRetryAfterMs !== undefined &&
    Number.isSafeInteger(params.serverRetryAfterMs) &&
    params.serverRetryAfterMs > 0
  ) {
    return Math.min(maxDelay, params.serverRetryAfterMs);
  }
  const exponent = Math.max(0, Math.floor(params.attemptCount));
  const raw = Math.min(maxDelay, params.baseDelayMs * 2 ** exponent);
  const jitterScale = 0.5 + Math.min(1, Math.max(0, params.entropy)) * 0.5;
  return Math.max(1, Math.floor(raw * jitterScale));
}
