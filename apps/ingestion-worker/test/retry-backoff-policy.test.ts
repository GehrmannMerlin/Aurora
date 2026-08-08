import { describe, expect, it } from 'vitest';
import { calculateRetryBackoffSchedule } from '../src/retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider } from '../src/retry-backoff-entropy.js';
import type { RetryBackoffConfig, RetryBackoffResult } from '../src/retry-backoff-types.js';

const NOW = new Date('2026-08-02T00:00:00.000Z');

function successOf(result: RetryBackoffResult): {
  delayMs: number;
  availableAt: Date;
  cappedDelayMs: number;
} {
  if (result.status !== 'success') {
    throw new Error(`expected success, got ${result.status}`);
  }
  return result;
}

describe('calculateRetryBackoffSchedule', () => {
  const config: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

  it('uses exponent 0 on the first attempt (attemptCount=1)', () => {
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 1,
        now: NOW,
        entropy: 0,
      }),
    );
    expect(result.cappedDelayMs).toBe(100);
  });

  it('doubles the delay on the second attempt', () => {
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 2,
        now: NOW,
        entropy: 0,
      }),
    );
    expect(result.cappedDelayMs).toBe(200);
  });

  it('saturates at maxDelayMs for large attempt counts', () => {
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 100,
        now: NOW,
        entropy: 0,
      }),
    );
    expect(result.cappedDelayMs).toBe(1000);
  });

  it('caps at maxDelayMs when initialDelayMs equals maxDelayMs', () => {
    const flat: RetryBackoffConfig = { initialDelayMs: 500, maxDelayMs: 500 };
    for (const attempt of [1, 2, 3]) {
      const result = successOf(
        calculateRetryBackoffSchedule({
          config: flat,
          attemptCount: attempt,
          now: NOW,
          entropy: 0,
        }),
      );
      expect(result.cappedDelayMs).toBe(500);
    }
  });

  it('with entropy=0 the delay is the lower bound', () => {
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 3,
        now: NOW,
        entropy: 0,
      }),
    );
    // capped = 400, lowerBound = 200
    expect(result.delayMs).toBe(200);
    expect(result.cappedDelayMs).toBe(400);
  });

  it('with entropy near 1 the delay stays within [lowerBound, capped]', () => {
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 3,
        now: NOW,
        entropy: 0.999999,
      }),
    );
    expect(result.delayMs).toBeGreaterThanOrEqual(200);
    expect(result.delayMs).toBeLessThanOrEqual(400);
  });

  it('handles odd and even capped delays', () => {
    const odd: RetryBackoffConfig = { initialDelayMs: 101, maxDelayMs: 1000 };
    const oddResult = successOf(
      calculateRetryBackoffSchedule({ config: odd, attemptCount: 1, now: NOW, entropy: 0 }),
    );
    expect(oddResult.delayMs).toBe(Math.ceil(101 / 2));

    const even: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };
    const evenResult = successOf(
      calculateRetryBackoffSchedule({ config: even, attemptCount: 1, now: NOW, entropy: 0 }),
    );
    expect(evenResult.delayMs).toBe(50);
  });

  it('returns a legal non-zero value for a tiny capped delay of 1 or 2', () => {
    const tiny: RetryBackoffConfig = { initialDelayMs: 1, maxDelayMs: 1 };
    const result = successOf(
      calculateRetryBackoffSchedule({ config: tiny, attemptCount: 1, now: NOW, entropy: 0 }),
    );
    expect(result.cappedDelayMs).toBe(1);
    expect(result.delayMs).toBeGreaterThanOrEqual(1);
    expect(result.delayMs).toBeLessThanOrEqual(1);
  });

  it('keeps availableAt at now + delay when notBefore is earlier', () => {
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 1,
        now: NOW,
        entropy: 0,
        notBefore: new Date(NOW.getTime() - 50_000),
      }),
    );
    // capped=100, lowerBound=50, entropy=0 -> delay 50
    expect(result.availableAt.getTime()).toBe(NOW.getTime() + 50);
  });

  it('raises availableAt to notBefore when it is later', () => {
    const lateNotBefore = new Date(NOW.getTime() + 10_000_000);
    const result = successOf(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 1,
        now: NOW,
        entropy: 0,
        notBefore: lateNotBefore,
      }),
    );
    expect(result.availableAt.getTime()).toBe(lateNotBefore.getTime());
  });

  it('returns invalid_config for zero, negative, or unsafe config values', () => {
    expect(
      calculateRetryBackoffSchedule({
        config: { initialDelayMs: 0, maxDelayMs: 1000 },
        attemptCount: 1,
        now: NOW,
        entropy: 0,
      }).status,
    ).toBe('invalid_config');
    expect(
      calculateRetryBackoffSchedule({
        config: { initialDelayMs: -1, maxDelayMs: 1000 },
        attemptCount: 1,
        now: NOW,
        entropy: 0,
      }).status,
    ).toBe('invalid_config');
    expect(
      calculateRetryBackoffSchedule({
        config: { initialDelayMs: 1000, maxDelayMs: 100 },
        attemptCount: 1,
        now: NOW,
        entropy: 0,
      }).status,
    ).toBe('invalid_config');
    expect(
      calculateRetryBackoffSchedule({
        config: { initialDelayMs: Number.MAX_SAFE_INTEGER + 1, maxDelayMs: 1000 },
        attemptCount: 1,
        now: NOW,
        entropy: 0,
      }).status,
    ).toBe('invalid_config');
  });

  it('returns invalid_attempt_count for zero, negative, or unsafe attempts', () => {
    for (const attempt of [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        calculateRetryBackoffSchedule({ config, attemptCount: attempt, now: NOW, entropy: 0 })
          .status,
      ).toBe('invalid_attempt_count');
    }
  });

  it('returns invalid_now for a non-Date or NaN date', () => {
    expect(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 1,
        now: new Date(Number.NaN),
        entropy: 0,
      }).status,
    ).toBe('invalid_now');
  });

  it('returns invalid_entropy for out-of-range or non-finite entropy', () => {
    for (const entropy of [-0.1, 1, 1.5, Number.NaN, Infinity, -Infinity]) {
      expect(
        calculateRetryBackoffSchedule({ config, attemptCount: 1, now: NOW, entropy }).status,
      ).toBe('invalid_entropy');
    }
  });

  it('returns invalid_not_before for an invalid notBefore', () => {
    expect(
      calculateRetryBackoffSchedule({
        config,
        attemptCount: 1,
        now: NOW,
        entropy: 0,
        notBefore: new Date(Number.NaN),
      }).status,
    ).toBe('invalid_not_before');
  });

  it('returns date_out_of_range when now + delay overflows Date', () => {
    const farFuture = new Date(MAX_DATE_TIME());
    const result = calculateRetryBackoffSchedule({
      config: { initialDelayMs: 1_000_000, maxDelayMs: 1_000_000 },
      attemptCount: 1,
      now: farFuture,
      entropy: 0,
    });
    expect(result.status).toBe('date_out_of_range');
  });

  it('does not modify its inputs', () => {
    const input = {
      config,
      attemptCount: 2,
      now: NOW,
      entropy: 0,
      notBefore: new Date(NOW.getTime() + 100),
    };
    const snapshot = {
      config: { ...input.config },
      attemptCount: input.attemptCount,
      now: input.now.getTime(),
      entropy: input.entropy,
      notBefore: input.notBefore.getTime(),
    };
    calculateRetryBackoffSchedule(input);
    expect(input.config).toEqual(snapshot.config);
    expect(input.attemptCount).toBe(snapshot.attemptCount);
    expect(input.now.getTime()).toBe(snapshot.now);
    expect(input.entropy).toBe(snapshot.entropy);
    expect(input.notBefore.getTime()).toBe(snapshot.notBefore);
  });

  it('returns a frozen success result', () => {
    const result = calculateRetryBackoffSchedule({ config, attemptCount: 1, now: NOW, entropy: 0 });
    if (result.status !== 'success') throw new Error('expected success');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.availableAt)).toBe(true);
  });
});

describe('createNodeCryptoEntropyProvider', () => {
  it('returns finite values in [0, 1) over many draws', () => {
    const provider = createNodeCryptoEntropyProvider();
    for (let i = 0; i < 200; i += 1) {
      const value = provider.next();
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

/** 8.64e15, the ECMA-262 max Date time value. */
function MAX_DATE_TIME(): number {
  return 8_640_000_000_000_000;
}
