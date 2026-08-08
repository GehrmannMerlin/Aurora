import { describe, expect, it } from 'vitest';
import { timeRange, utcTimestamp } from '../../src/common/time.js';

describe('time contracts', () => {
  it('validates RFC3339 timestamps and bounded ranges', () => {
    expect(utcTimestamp.zod.safeParse('2026-08-08T00:00:00.000Z').success).toBe(true);
    expect(utcTimestamp.zod.safeParse('not-a-date').success).toBe(false);
    expect(
      timeRange.zod.safeParse({
        start: '2026-08-08T00:00:00.000Z',
        end: '2026-08-08T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
