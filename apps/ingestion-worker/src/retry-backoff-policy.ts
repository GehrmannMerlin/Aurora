import type { RetryBackoffConfig, RetryBackoffResult } from './retry-backoff-types.js';

/** Upper bound for Date.getTime() (8.64e15), matching ECMA-262. */
const MAX_DATE_MS = 8_640_000_000_000_000;

export interface CalculateRetryBackoffScheduleInput {
  readonly config: RetryBackoffConfig;
  readonly attemptCount: number;
  readonly now: Date;
  readonly entropy: number;
  readonly notBefore?: Date;
}

function isValidConfig(config: RetryBackoffConfig): boolean {
  if (
    !Number.isSafeInteger(config.initialDelayMs) ||
    config.initialDelayMs <= 0 ||
    !Number.isSafeInteger(config.maxDelayMs) ||
    config.maxDelayMs <= 0
  ) {
    return false;
  }
  if (config.maxDelayMs < config.initialDelayMs) return false;
  return true;
}

function isValidAttemptCount(attemptCount: number): boolean {
  return Number.isSafeInteger(attemptCount) && attemptCount >= 1;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isValidEntropy(entropy: number): boolean {
  return Number.isFinite(entropy) && entropy >= 0 && entropy < 1;
}

/**
 * Saturated exponential delay: initialDelayMs * 2^(attempt-1), never exceeding
 * maxDelayMs and never producing Infinity or an unsafe integer. Iterative
 * doubling stops as soon as the value would exceed maxDelayMs.
 */
function computeExponentialDelay(
  initialDelayMs: number,
  maxDelayMs: number,
  attemptCount: number,
): number {
  const steps = attemptCount - 1;
  let value = initialDelayMs;
  for (let i = 0; i < steps; i += 1) {
    if (value > maxDelayMs / 2) {
      return maxDelayMs;
    }
    value *= 2;
    if (!Number.isSafeInteger(value) || value >= maxDelayMs) {
      return maxDelayMs;
    }
  }
  return Math.min(value, maxDelayMs);
}

/**
 * Pure retry backoff schedule: capped exponential backoff + equal jitter.
 * Computes only time; never sleeps, never touches the database, never calls
 * scheduleRetry/markDeadLettered, never modifies inputs, and returns a stable
 * discriminable result instead of throwing for normal control flow.
 */
export function calculateRetryBackoffSchedule(
  input: CalculateRetryBackoffScheduleInput,
): RetryBackoffResult {
  if (!isValidConfig(input.config)) {
    return { status: 'invalid_config' };
  }
  if (!isValidAttemptCount(input.attemptCount)) {
    return { status: 'invalid_attempt_count' };
  }
  if (!isValidDate(input.now)) {
    return { status: 'invalid_now' };
  }
  if (!isValidEntropy(input.entropy)) {
    return { status: 'invalid_entropy' };
  }
  if (input.notBefore !== undefined && !isValidDate(input.notBefore)) {
    return { status: 'invalid_not_before' };
  }

  const { initialDelayMs, maxDelayMs } = input.config;
  const cappedDelayMs = computeExponentialDelay(
    initialDelayMs,
    maxDelayMs,
    input.attemptCount,
  );
  const lowerBound = Math.ceil(cappedDelayMs / 2);
  const jitterSpan = cappedDelayMs - lowerBound + 1;
  const delayMs = lowerBound + Math.floor(input.entropy * jitterSpan);

  const nowMs = input.now.getTime();
  const calculatedAt = nowMs + delayMs;
  if (!Number.isSafeInteger(calculatedAt) || calculatedAt > MAX_DATE_MS) {
    return { status: 'date_out_of_range' };
  }
  const notBeforeMs =
    input.notBefore === undefined ? undefined : input.notBefore.getTime();
  const availableAtMs =
    notBeforeMs === undefined
      ? calculatedAt
      : Math.max(calculatedAt, notBeforeMs);
  if (availableAtMs > MAX_DATE_MS) {
    return { status: 'date_out_of_range' };
  }

  return Object.freeze({
    status: 'success',
    delayMs,
    availableAt: Object.freeze(new Date(availableAtMs)),
    cappedDelayMs,
  });
}
