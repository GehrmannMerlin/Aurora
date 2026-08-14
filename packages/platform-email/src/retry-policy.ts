export interface CalculateEmailRetryDelayInput {
  readonly attempt: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly entropy01: number;
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}

/** Capped exponential backoff with deterministic equal jitter. */
export function calculateEmailRetryDelay(input: CalculateEmailRetryDelayInput): number {
  requirePositiveInteger(input.attempt, 'attempt');
  requirePositiveInteger(input.baseDelayMs, 'baseDelayMs');
  requirePositiveInteger(input.maxDelayMs, 'maxDelayMs');
  if (!Number.isFinite(input.entropy01) || input.entropy01 < 0 || input.entropy01 > 1) {
    throw new TypeError('entropy01 must be finite and within 0..1');
  }

  const exponent = Math.min(input.attempt - 1, 52);
  const capped = Math.min(input.maxDelayMs, input.baseDelayMs * 2 ** exponent);
  const equalJitter = capped / 2 + (capped / 2) * input.entropy01;
  return Math.min(input.maxDelayMs, Math.max(0, Math.round(equalJitter)));
}
