import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('performance event types', () => {
  it('exposes exactly the approved metric category, names, and units', () => {
    expect(PerformanceMetricCategory).toEqual({ Page: 'page' });
    expect(PerformanceMetricName).toEqual({
      Lcp: 'lcp',
      Inp: 'inp',
      Cls: 'cls',
      PageLoad: 'page_load',
    });
    expect(PerformanceMetricUnit).toEqual({ Millisecond: 'millisecond', Ratio: 'ratio' });
  });

  it('exposes bounded performance limits', () => {
    expect(PERFORMANCE_EVENT_LIMITS).toEqual({
      maxMetricNameLength: 64,
      maxValueSafeInteger: 2147483647,
      maxRatioValue: 1,
      maxDurationMs: 86400000,
    });
  });

  it('does not include unapproved metrics', () => {
    const values = Object.values(PerformanceMetricName);
    for (const unapproved of ['fcp', 'ttfb', 'fid', 'tbt', 'custom_metric']) {
      expect(values).not.toContain(unapproved);
    }
  });
});
