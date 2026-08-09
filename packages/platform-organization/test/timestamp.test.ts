import { describe, expect, it } from 'vitest';
import { isoTimestamp } from '../src/repositories/timestamp.js';

describe('isoTimestamp', () => {
  it('normalizes a JS Date, an ISO string, and null', () => {
    const date = new Date('2026-08-09T00:00:00.000Z');
    expect(isoTimestamp(date)).toBe('2026-08-09T00:00:00.000Z');
    expect(isoTimestamp('2026-08-09T00:00:00.000Z')).toBe('2026-08-09T00:00:00.000Z');
    expect(isoTimestamp(null)).toBeNull();
  });
});
