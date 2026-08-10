import { describe, expect, it } from 'vitest';
import { defaultTimeRange } from '../../src/monitoring/time-range.js';

describe('defaultTimeRange', () => {
  it('builds a deterministic RFC 3339 UTC 24h window ending at the given now', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const range = defaultTimeRange(now);
    expect(range.end).toBe('2026-08-10T12:00:00.000Z');
    expect(range.start).toBe('2026-08-09T12:00:00.000Z');
  });

  it('supports a custom window width', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    const range = defaultTimeRange(now, 7 * 24);
    expect(range.start).toBe('2026-08-03T12:00:00.000Z');
  });

  it('produces start < end', () => {
    const range = defaultTimeRange(new Date('2026-08-10T12:00:00.000Z'));
    expect(range.start < range.end).toBe(true);
  });
});
