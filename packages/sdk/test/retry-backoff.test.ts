import { describe, expect, it } from 'vitest';
import { calculateSdkRetryDelay } from '../src/index.js';

describe('calculateSdkRetryDelay', () => {
  it('grows from the base and never exceeds maxDelayMs', () => {
    const first = calculateSdkRetryDelay({ attemptCount: 0, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0 });
    const tenth = calculateSdkRetryDelay({ attemptCount: 10, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0 });
    expect(first).toBeGreaterThanOrEqual(250);
    expect(tenth).toBeLessThanOrEqual(30_000);
  });

  it('is capped at maxDelayMs even with high attempts', () => {
    const delay = calculateSdkRetryDelay({ attemptCount: 50, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 1 });
    expect(delay).toBeLessThanOrEqual(30_000);
  });

  it('uses server retryAfterMs when provided, capped at maxDelayMs', () => {
    expect(
      calculateSdkRetryDelay({ attemptCount: 0, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0, serverRetryAfterMs: 86400000 }),
    ).toBe(30_000);
    expect(
      calculateSdkRetryDelay({ attemptCount: 0, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0, serverRetryAfterMs: 1000 }),
    ).toBe(1000);
  });

  it('always returns a positive safe integer', () => {
    const delay = calculateSdkRetryDelay({ attemptCount: 3, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0.5 });
    expect(Number.isSafeInteger(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(1);
  });
});
