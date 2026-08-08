import { describe, expect, it } from 'vitest';
import {
  computeBucketStart,
  parsePerformanceMetricContributionInput,
} from '../src/performance-metric-contribution.js';

describe('computeBucketStart', () => {
  it('floors a timestamp to the start of its UTC minute', () => {
    expect(computeBucketStart(1_800_000_054_000).toISOString()).toBe('2027-01-15T08:00:00.000Z');
    expect(computeBucketStart(1_800_000_059_999).toISOString()).toBe('2027-01-15T08:00:00.000Z');
    expect(computeBucketStart(1_800_000_060_000).toISOString()).toBe('2027-01-15T08:01:00.000Z');
  });
});

describe('parsePerformanceMetricContributionInput', () => {
  const valid = {
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-perf-1',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
  };

  it('accepts a valid lcp millisecond contribution', () => {
    const result = parsePerformanceMetricContributionInput(valid);
    expect(result).toMatchObject({
      projectId: valid.projectId,
      eventId: valid.eventId,
      metricName: 'lcp',
      unit: 'millisecond',
      value: 2500,
      bucketStartIso: '2027-01-15T08:00:00.000Z',
    });
  });

  it('accepts a valid cls ratio contribution', () => {
    const result = parsePerformanceMetricContributionInput({
      ...valid,
      eventId: 'evt-perf-cls',
      metricName: 'cls',
      unit: 'ratio',
      value: 0.12,
    });
    expect(result).toMatchObject({ metricName: 'cls', unit: 'ratio', value: 0.12 });
  });

  it('accepts an optional durationMs', () => {
    const result = parsePerformanceMetricContributionInput({
      ...valid,
      eventId: 'evt-perf-dur',
      durationMs: 300,
    });
    expect(result).toMatchObject({ durationMs: 300 });
  });

  it('rejects a non-object top level', () => {
    expect(parsePerformanceMetricContributionInput(null)).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
  });

  it('rejects a missing required field', () => {
    const { metricName: _omit, ...rest } = valid;
    void _omit;
    expect(parsePerformanceMetricContributionInput(rest)).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an empty projectId', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, projectId: '' }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an unknown metric name', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, metricName: 'fcp' }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an unknown unit', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, unit: 'bytes' }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a negative value', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, value: -1 }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a non-finite value', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, value: Number.NaN }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a millisecond value above the safe integer limit', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, value: 2_147_483_648 }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a ratio value above 1', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, metricName: 'cls', unit: 'ratio', value: 1.5 }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a non-safe-integer occurredAt', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, occurredAt: Number.NaN }),
    ).toMatchObject({ status: 'invalid_input' });
  });
});
