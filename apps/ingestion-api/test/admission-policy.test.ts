import { describe, expect, it } from 'vitest';
import {
  createIngestionAdmissionPolicy,
  DEFAULT_INGESTION_ADMISSION_POLICY_CONFIG,
} from '../src/admission-policy.js';

describe('createIngestionAdmissionPolicy (ING-12 rate limiter)', () => {
  it('allows requests within the sustainable event rate', async () => {
    const policy = createIngestionAdmissionPolicy({ maxEventsPerSecond: 10, retryAfterMs: 1000 });
    for (let i = 0; i < 10; i += 1) {
      await expect(policy.check({ requestId: `r-${String(i)}`, eventCount: 1 })).resolves.toEqual({
        status: 'allow',
      });
    }
  });

  it('rejects with retryAfterMs when the rate is exceeded', async () => {
    const policy = createIngestionAdmissionPolicy({ maxEventsPerSecond: 3, retryAfterMs: 1000 });
    await policy.check({ requestId: 'r-0', eventCount: 1 });
    await policy.check({ requestId: 'r-1', eventCount: 1 });
    await policy.check({ requestId: 'r-2', eventCount: 1 });
    await expect(policy.check({ requestId: 'r-3', eventCount: 1 })).resolves.toEqual({
      status: 'temporarilyRejected',
      retryAfterMs: 1000,
    });
  });

  it('refills tokens as time advances (injectable clock)', async () => {
    let nowMs = 0;
    const policy = createIngestionAdmissionPolicy(
      { maxEventsPerSecond: 10, retryAfterMs: 1000 },
      { now: () => nowMs },
    );
    await policy.check({ requestId: 'r-0', eventCount: 10 }); // exhausts the bucket
    await expect(policy.check({ requestId: 'r-1', eventCount: 1 })).resolves.toEqual({
      status: 'temporarilyRejected',
      retryAfterMs: 1000,
    });
    nowMs += 1000; // one second elapses → full refill
    await expect(policy.check({ requestId: 'r-2', eventCount: 1 })).resolves.toEqual({
      status: 'allow',
    });
  });

  it('consumes eventCount tokens per batch (event-rate, not request-rate)', async () => {
    const policy = createIngestionAdmissionPolicy({ maxEventsPerSecond: 10, retryAfterMs: 1000 });
    await expect(policy.check({ requestId: 'r-0', eventCount: 5 })).resolves.toEqual({
      status: 'allow',
    });
    await expect(policy.check({ requestId: 'r-1', eventCount: 5 })).resolves.toEqual({
      status: 'allow',
    });
    await expect(policy.check({ requestId: 'r-2', eventCount: 1 })).resolves.toEqual({
      status: 'temporarilyRejected',
      retryAfterMs: 1000,
    });
  });

  it('treats an undefined eventCount as a single unit', async () => {
    const policy = createIngestionAdmissionPolicy({ maxEventsPerSecond: 1, retryAfterMs: 1000 });
    await expect(policy.check({ requestId: 'r-0' })).resolves.toEqual({ status: 'allow' });
    await expect(policy.check({ requestId: 'r-1' })).resolves.toEqual({
      status: 'temporarilyRejected',
      retryAfterMs: 1000,
    });
  });

  it('rejects invalid config', () => {
    expect(() => createIngestionAdmissionPolicy({ maxEventsPerSecond: 0, retryAfterMs: 1000 })).toThrow(
      /maxEventsPerSecond/,
    );
    expect(() => createIngestionAdmissionPolicy({ maxEventsPerSecond: 10, retryAfterMs: 0 })).toThrow(
      /retryAfterMs/,
    );
  });
});

describe('DEFAULT_INGESTION_ADMISSION_POLICY_CONFIG (ING-13-traced)', () => {
  it('is frozen and carries the ING-13 approved sustainable event rate', () => {
    expect(Object.isFrozen(DEFAULT_INGESTION_ADMISSION_POLICY_CONFIG)).toBe(true);
    expect(DEFAULT_INGESTION_ADMISSION_POLICY_CONFIG.maxEventsPerSecond).toBe(400);
    expect(DEFAULT_INGESTION_ADMISSION_POLICY_CONFIG.retryAfterMs).toBe(1000);
  });
});
