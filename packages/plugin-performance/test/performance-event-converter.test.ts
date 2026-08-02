import {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  type BrowserPerformanceSourceEvent,
} from '@aurora/browser';
import { parsePerformanceEventBody } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { createPerformanceEventConverter } from '../src/performance-event-converter.js';

const converter = createPerformanceEventConverter();

function fact(
  overrides: Partial<BrowserPerformanceSourceEvent> = {},
): BrowserPerformanceSourceEvent {
  return {
    metricName: BrowserPerformanceMetricName.Lcp,
    value: 2500,
    unit: BrowserPerformanceMetricUnit.Millisecond,
    startedAt: 1800000005000,
    ...overrides,
  };
}

describe('performance event converter', () => {
  it('maps all four approved metrics to valid bodies without recomputation', () => {
    const cases: readonly {
      readonly metricName: BrowserPerformanceSourceEvent['metricName'];
      readonly unit: BrowserPerformanceSourceEvent['unit'];
      readonly value: number;
    }[] = [
      { metricName: 'lcp', unit: 'millisecond', value: 2500 },
      { metricName: 'inp', unit: 'millisecond', value: 180 },
      { metricName: 'cls', unit: 'ratio', value: 0.125 },
      { metricName: 'page_load', unit: 'millisecond', value: 3200 },
    ];
    for (const c of cases) {
      const result = converter.convert(
        fact({ metricName: c.metricName, unit: c.unit, value: c.value }),
      );
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(`must succeed for ${c.metricName}`);
      expect(result.data).toMatchObject({
        metricCategory: 'page',
        metricName: c.metricName,
        value: c.value,
        unit: c.unit,
        startedAt: 1800000005000,
      });
      expect(parsePerformanceEventBody(result.data).success).toBe(true);
    }
  });

  it('preserves the optional durationMs when present', () => {
    const result = converter.convert(fact({ metricName: 'page_load', durationMs: 3400 }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.durationMs).toBe(3400);
  });

  it('omits durationMs when undefined', () => {
    const result = converter.convert(fact());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect('durationMs' in result.data).toBe(false);
  });

  it('does not modify the input fact', () => {
    const input = fact();
    const snapshot = JSON.stringify(input);
    converter.convert(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('rejects invalid metric names and units as performance_fact_invalid', () => {
    expect(converter.convert(fact({ metricName: 'fcp' as never }))).toEqual({
      success: false,
      code: 'performance_fact_invalid',
    });
    expect(converter.convert(fact({ unit: 'second' as never }))).toEqual({
      success: false,
      code: 'performance_fact_invalid',
    });
  });

  it('rejects NaN and Infinity values as performance_fact_invalid', () => {
    expect(converter.convert(fact({ value: Number.NaN }))).toEqual({
      success: false,
      code: 'performance_fact_invalid',
    });
    expect(converter.convert(fact({ value: Number.POSITIVE_INFINITY }))).toEqual({
      success: false,
      code: 'performance_fact_invalid',
    });
  });

  it('rejects negative and out-of-range CLS through the schema', () => {
    const negative = converter.convert(fact({ value: -1 }));
    expect(negative.success).toBe(false);
    const clsOver = converter.convert(fact({ metricName: 'cls', unit: 'ratio', value: 1.5 }));
    expect(clsOver.success).toBe(false);
    if (!clsOver.success && 'issues' in clsOver) {
      expect(clsOver.issues.map(({ code }) => code)).toContain('invalid_number');
    } else {
      throw new Error('clsOver must be rejected by the schema with issues');
    }
  });

  it('rejects missing startedAt through the schema', () => {
    const result = converter.convert(fact({ startedAt: 0 }));
    expect(result.success).toBe(false);
  });
});
