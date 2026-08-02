import { parsePerformanceEventBody } from '../src/performance-event-body.js';
import { describe, expect, it } from 'vitest';

describe('performance event body parsing', () => {
  it('parses a minimal successful LCP in milliseconds', () => {
    expect(
      parsePerformanceEventBody({
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      }),
    ).toEqual({
      success: true,
      data: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    });
  });

  it('parses a CLS ratio without integer constraint', () => {
    const result = parsePerformanceEventBody({
      metricCategory: 'page',
      metricName: 'cls',
      value: 0.125,
      unit: 'ratio',
      startedAt: 1_800_000_005_001,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.value).toBe(0.125);
  });

  it('parses all four approved metric names', () => {
    for (const metricName of ['lcp', 'inp', 'cls', 'page_load'] as const) {
      const unit = metricName === 'cls' ? 'ratio' : 'millisecond';
      const value = metricName === 'cls' ? 0.1 : 1500;
      expect(
        parsePerformanceEventBody({
          metricCategory: 'page',
          metricName,
          value,
          unit,
          startedAt: 1_800_000_005_002,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts an optional durationMs', () => {
    expect(
      parsePerformanceEventBody({
        metricCategory: 'page',
        metricName: 'page_load',
        value: 3200,
        unit: 'millisecond',
        startedAt: 1_800_000_005_003,
        durationMs: 3400,
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      { metricName: 'lcp', value: 2500, unit: 'millisecond', startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', value: 2500, unit: 'millisecond', startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', unit: 'millisecond', startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 2500, startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 2500, unit: 'millisecond' },
      'missing_required_field',
    ],
    [
      { metricCategory: 'Page', metricName: 'lcp', value: 1, unit: 'millisecond', startedAt: 1 },
      'invalid_enum',
    ],
    [
      { metricCategory: 'page', metricName: 'fcp', value: 1, unit: 'millisecond', startedAt: 1 },
      'invalid_enum',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 1, unit: 'second', startedAt: 1 },
      'invalid_enum',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: -1, unit: 'millisecond', startedAt: 1 },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500.5,
        unit: 'millisecond',
        startedAt: 1,
      },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: Number.NaN,
        unit: 'millisecond',
        startedAt: 1,
      },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'cls', value: 1.5, unit: 'ratio', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'cls', value: -0.1, unit: 'ratio', startedAt: 1 },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2147483648,
        unit: 'millisecond',
        startedAt: 1,
      },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 1, unit: 'millisecond', startedAt: 0 },
      'invalid_timestamp',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 1,
        unit: 'millisecond',
        startedAt: 1,
        durationMs: 86400001,
      },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 1,
        unit: 'millisecond',
        startedAt: 1,
        durationMs: -1,
      },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 1,
        unit: 'millisecond',
        startedAt: 1,
        page: 'x',
      },
      'unknown_field',
    ],
  ] as const)('rejects invalid performance body %# with %s', (input, issueCode) => {
    const result = parsePerformanceEventBody(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain(issueCode);
    }
  });

  it('does not modify the input object', () => {
    const input = Object.freeze({
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_005_004,
    });
    const before = { ...input };
    parsePerformanceEventBody(input);
    expect(input).toEqual(before);
  });

  it('does not retain input object references in the success result', () => {
    const input = {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_005_005,
    };
    const result = parsePerformanceEventBody(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data).not.toBe(input);
  });
});
