import { describe, expect, it } from 'vitest';
import {
  computeBucketStart,
  parseRequestMetricContributionInput,
} from '../src/request-metric-contribution.js';
import type { RequestMetricBucketParams } from '../src/request-metric-types.js';

const validInput = {
  projectId: 'p-metric',
  eventId: 'evt-metric-1',
  occurredAt: 1_800_000_054_000, // 12:34:00.000 UTC
  method: 'GET',
  outcome: 'success',
  statusCode: 200,
  durationMs: 120,
  isFailure: false,
  isSlow: false,
};

describe('computeBucketStart', () => {
  it('floors to the UTC minute boundary', () => {
    expect(computeBucketStart(1_800_000_054_000).toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('keeps the same minute just before the boundary', () => {
    expect(computeBucketStart(1_800_000_059_999).toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('rolls to the next minute at the boundary', () => {
    expect(computeBucketStart(1_800_000_060_000).toISOString()).toBe('2027-01-15T08:01:00.000Z');
  });

  it('floors one millisecond past the boundary', () => {
    expect(computeBucketStart(1_800_000_054_001).toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });
});

describe('parseRequestMetricContributionInput', () => {
  it('rejects a non-object top-level input', () => {
    for (const input of [null, 'text', 42, [], undefined]) {
      expect(parseRequestMetricContributionInput(input)).toEqual({
        status: 'invalid_input',
        code: 'invalid_top_level',
      });
    }
  });

  it('rejects missing or invalid projectId / eventId', () => {
    expect(parseRequestMetricContributionInput({ ...validInput, projectId: '' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_project_id',
    });
    expect(parseRequestMetricContributionInput({ ...validInput, eventId: '' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_event_id',
    });
  });

  it('rejects invalid occurredAt', () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseRequestMetricContributionInput({ ...validInput, occurredAt: value })).toEqual({
        status: 'invalid_input',
        code: 'invalid_occurred_at',
      });
    }
  });

  it('rejects invalid durationMs', () => {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseRequestMetricContributionInput({ ...validInput, durationMs: value })).toEqual({
        status: 'invalid_input',
        code: 'invalid_duration_ms',
      });
    }
  });

  it('rejects invalid method / outcome enums', () => {
    expect(parseRequestMetricContributionInput({ ...validInput, method: 'TRACE' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_method',
    });
    expect(parseRequestMetricContributionInput({ ...validInput, outcome: 'mystery' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_outcome',
    });
  });

  it('rejects invalid statusCode', () => {
    for (const value of [99, 600, 200.5, -1]) {
      expect(parseRequestMetricContributionInput({ ...validInput, statusCode: value })).toEqual({
        status: 'invalid_input',
        code: 'invalid_status_code',
      });
    }
  });

  it('rejects non-boolean isFailure / isSlow', () => {
    expect(parseRequestMetricContributionInput({ ...validInput, isFailure: 1 })).toEqual({
      status: 'invalid_input',
      code: 'invalid_boolean',
    });
    expect(parseRequestMetricContributionInput({ ...validInput, isSlow: 'yes' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_boolean',
    });
  });

  it('accepts a valid contribution and computes the bucket', () => {
    const result = parseRequestMetricContributionInput(validInput);
    expect('status' in result).toBe(false);
    if ('status' in result) return;
    const expected: RequestMetricBucketParams = {
      projectId: 'p-metric',
      eventId: 'evt-metric-1',
      bucketStartIso: '2027-01-15T08:00:00.000Z',
      method: 'GET',
      outcome: 'success',
      statusCode: 200,
      durationMs: 120,
      isFailure: false,
      isSlow: false,
    };
    expect(result).toEqual(expected);
  });

  it('maps a missing statusCode to the 0 sentinel', () => {
    const { statusCode, ...withoutStatusCode } = validInput;
    void statusCode;
    const result = parseRequestMetricContributionInput(withoutStatusCode);
    expect('status' in result).toBe(false);
    if ('status' in result) return;
    expect(result.statusCode).toBe(0);
  });

  it('does not mutate the input', () => {
    const input = structuredClone(validInput);
    const snapshot = structuredClone(input);
    parseRequestMetricContributionInput(input);
    expect(input).toEqual(snapshot);
  });
});
