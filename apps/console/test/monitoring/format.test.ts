import { describe, expect, it } from 'vitest';
import { formatBoundedCount, formatCount, formatUtc } from '../../src/monitoring/format.js';

describe('formatUtc', () => {
  it('renders RFC 3339 UTC wall time with an explicit UTC label', () => {
    expect(formatUtc('2026-08-10T09:30:00.000Z')).toBe('2026-08-10 09:30 UTC');
  });

  it('drops sub-second precision but keeps the date', () => {
    expect(formatUtc('2026-08-10T09:30:05.123Z')).toBe('2026-08-10 09:30 UTC');
  });

  it('never converts to local time', () => {
    expect(formatUtc('2026-08-10T23:59:59Z')).toBe('2026-08-10 23:59 UTC');
  });
});

describe('formatCount', () => {
  it('renders exact non-negative counts verbatim', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(3)).toBe('3');
    expect(formatCount(1200)).toBe('1200');
  });

  it('does not invent a value for missing/negative input', () => {
    expect(formatCount(Number.NaN)).toBe('—');
    expect(formatCount(-1)).toBe('—');
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatBoundedCount', () => {
  it('signals counts at the documented cap without overstating', () => {
    expect(formatBoundedCount(3, 100)).toBe('3');
    expect(formatBoundedCount(100, 100)).toBe('100+');
    expect(formatBoundedCount(120, 100)).toBe('100+');
  });
});
