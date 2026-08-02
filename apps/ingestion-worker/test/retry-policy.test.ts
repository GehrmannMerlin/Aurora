import { describe, expect, it } from 'vitest';
import { decideRetryDisposition } from '../src/retry-policy.js';

const base = {
  attemptCount: 1,
  maxProcessingAttempts: 3,
  availableAt: new Date('2026-08-02T00:00:30Z'),
  errorCode: 'service_temporarily_unavailable',
};

describe('decideRetryDisposition', () => {
  it('schedules a retry while attempts remain', () => {
    const result = decideRetryDisposition({ ...base, attemptCount: 1 });
    expect(result.status).toBe('schedule-retry');
    if (result.status === 'schedule-retry') {
      expect(result.availableAt).toEqual(base.availableAt);
      expect(result.errorCode).toBe('service_temporarily_unavailable');
    }
  });

  it('schedules a retry on the second attempt under max 3', () => {
    const result = decideRetryDisposition({ ...base, attemptCount: 2 });
    expect(result.status).toBe('schedule-retry');
  });

  it('dead-letters when the budget is exhausted at attempt 3 of 3', () => {
    const result = decideRetryDisposition({ ...base, attemptCount: 3 });
    expect(result.status).toBe('dead-letter');
    if (result.status === 'dead-letter') {
      expect(result.errorCode).toBe('retry_budget_exhausted');
    }
  });

  it('dead-letters when the attempt count exceeds the max', () => {
    const result = decideRetryDisposition({ ...base, attemptCount: 4 });
    expect(result.status).toBe('dead-letter');
    if (result.status === 'dead-letter') {
      expect(result.errorCode).toBe('retry_budget_exhausted');
    }
  });

  it('does not modify the input', () => {
    const input = { ...base };
    decideRetryDisposition(input);
    expect(input.attemptCount).toBe(1);
    expect(input.maxProcessingAttempts).toBe(3);
    expect(input.errorCode).toBe('service_temporarily_unavailable');
  });

  it('returns invalid for a non-positive attempt count', () => {
    const result = decideRetryDisposition({ ...base, attemptCount: 0 });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.diagnosticCode).toBe('processor_retry_result_invalid');
    }
  });

  it('returns invalid for a non-positive max', () => {
    const result = decideRetryDisposition({ ...base, maxProcessingAttempts: 0 });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for an invalid Date', () => {
    const result = decideRetryDisposition({
      ...base,
      availableAt: new Date(NaN),
    });
    expect(result.status).toBe('invalid');
  });

  it('returns invalid for an empty errorCode', () => {
    const result = decideRetryDisposition({ ...base, errorCode: '' });
    expect(result.status).toBe('invalid');
  });

  it('does not throw for normal control flow', () => {
    expect(() => decideRetryDisposition({ ...base, attemptCount: 0 })).not.toThrow();
    expect(() => decideRetryDisposition({ ...base, availableAt: new Date(NaN) })).not.toThrow();
  });
});
