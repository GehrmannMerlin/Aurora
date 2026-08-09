import { describe, expect, it } from 'vitest';
import { isoTimestamp, isoVersionKey } from '../src/repositories/timestamp.js';

describe('timestamp helpers', () => {
  it('isoTimestamp normalizes a JS Date, an ISO string, and null', () => {
    const date = new Date('2026-08-09T00:00:00.000Z');
    expect(isoTimestamp(date)).toBe('2026-08-09T00:00:00.000Z');
    expect(isoTimestamp('2026-08-09T00:00:00.000Z')).toBe('2026-08-09T00:00:00.000Z');
    expect(isoTimestamp(null)).toBeNull();
  });

  it('isoVersionKey normalizes both Date and string inputs to millisecond ISO', () => {
    expect(isoVersionKey(new Date('2026-08-09T00:00:00.123Z'))).toBe('2026-08-09T00:00:00.123Z');
    expect(isoVersionKey('2026-08-09T00:00:00.123Z')).toBe('2026-08-09T00:00:00.123Z');
    // PostgreSQL microsecond precision is truncated by JS Date to milliseconds.
    expect(isoVersionKey(new Date('2026-08-09T00:00:00.123456Z'))).toBe('2026-08-09T00:00:00.123Z');
  });
});
