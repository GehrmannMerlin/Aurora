import { describe, expect, it } from 'vitest';
import { ProcessingStoreError } from '../src/errors.js';
import {
  knownMetricName,
  knownUnit,
  metricMean,
} from '../src/performance-metric-query-repository.js';

describe('performance metric query helpers', () => {
  it('knownMetricName accepts every public performance metric name', () => {
    expect(knownMetricName('lcp')).toBe('lcp');
    expect(knownMetricName('inp')).toBe('inp');
    expect(knownMetricName('cls')).toBe('cls');
    expect(knownMetricName('page_load')).toBe('page_load');
  });

  it('knownMetricName rejects unknown names with ProcessingStoreError invalid_input', () => {
    expect(() => knownMetricName('fcp')).toThrow(ProcessingStoreError);
    try {
      knownMetricName('fcp');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingStoreError);
      expect((error as ProcessingStoreError).kind).toBe('invalid_input');
    }
  });

  it('knownUnit accepts every public performance metric unit', () => {
    expect(knownUnit('millisecond')).toBe('millisecond');
    expect(knownUnit('ratio')).toBe('ratio');
  });

  it('knownUnit rejects unknown units with ProcessingStoreError invalid_input', () => {
    expect(() => knownUnit('percent')).toThrow(ProcessingStoreError);
    try {
      knownUnit('percent');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingStoreError);
      expect((error as ProcessingStoreError).kind).toBe('invalid_input');
    }
  });

  it('metricMean is value_sum / observed_count', () => {
    expect(metricMean(2, 5700)).toBe(2850);
    expect(metricMean(1, 1500)).toBe(1500);
    expect(metricMean(1, 0.12)).toBeCloseTo(0.12);
  });

  it('metricMean is 0 for a zero-observed aggregate (defensive; zero rows are never returned)', () => {
    expect(metricMean(0, 100)).toBe(0);
  });
});
