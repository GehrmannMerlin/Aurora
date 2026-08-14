import { describe, expect, it } from 'vitest';
import { calculateEmailRetryDelay } from '../src/retry-policy.js';

describe('calculateEmailRetryDelay', () => {
  it.each([0, 0.25, 0.5, 0.75, 1])('returns a bounded finite delay for entropy %s', (entropy01) => {
    const delay = calculateEmailRetryDelay({
      attempt: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 300_000,
      entropy01,
    });
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(300_000);
  });

  it('grows monotonically until the cap for fixed entropy', () => {
    const delays = Array.from({ length: 20 }, (_, index) =>
      calculateEmailRetryDelay({
        attempt: index + 1,
        baseDelayMs: 1_000,
        maxDelayMs: 300_000,
        entropy01: 0.5,
      }),
    );
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1] ?? 0);
    }
    expect(delays.at(-1)).toBeLessThanOrEqual(300_000);
  });

  it.each([
    { attempt: 0, baseDelayMs: 1_000, maxDelayMs: 300_000, entropy01: 0.5 },
    { attempt: 1, baseDelayMs: 0, maxDelayMs: 300_000, entropy01: 0.5 },
    { attempt: 1, baseDelayMs: 1_000, maxDelayMs: 0, entropy01: 0.5 },
    { attempt: 1, baseDelayMs: 1_000, maxDelayMs: 300_000, entropy01: -0.1 },
    { attempt: 1, baseDelayMs: 1_000, maxDelayMs: 300_000, entropy01: 1.1 },
  ])('rejects invalid bounded inputs', (input) => {
    expect(() => calculateEmailRetryDelay(input)).toThrow(TypeError);
  });
});
