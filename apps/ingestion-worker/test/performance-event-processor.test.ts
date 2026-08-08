import { describe, expect, it, vi } from 'vitest';
import type {
  PersistPerformanceMetricContributionResult,
  PerformanceMetricContributionInput,
} from '@aurora/processing-store';
import { persistPerformanceEventSample } from '@aurora/processing-store';
import {
  createPerformanceEventProcessor,
  type PersistPerformanceMetricFn,
  type PerformanceEventProcessorDiagnostics,
} from '../src/performance-event-processor.js';
import type { ProcessIngestionEventInput } from '../src/processor.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from '../src/retry-backoff-types.js';

const NOW = new Date('2026-08-07T00:00:00.000Z');
const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

function zeroEntropy(): RetryBackoffEntropyProvider {
  return { next: () => 0 };
}

function performanceEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_054_000,
    body: {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
      ...bodyOverrides,
    },
  };
}

function validInput(overrides?: Partial<ProcessIngestionEventInput>): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-perf-1',
    event: performanceEnvelope('evt-perf-1') as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
    ...overrides,
  };
}

function metricResult(
  status: PersistPerformanceMetricContributionResult['status'],
): PersistPerformanceMetricContributionResult {
  return status === 'applied'
    ? { status: 'applied' }
    : status === 'duplicate'
      ? { status: 'duplicate' }
      : status === 'invalid_input'
        ? { status: 'invalid_input', code: 'invalid_metric_name' }
        : { status: 'temporarily_unavailable' };
}

function recordingDiagnostics(): {
  diagnostics: PerformanceEventProcessorDiagnostics;
  codes: string[];
} {
  const codes: string[] = [];
  return {
    codes,
    diagnostics: {
      record: (entry) => {
        codes.push(entry.code);
      },
    },
  };
}

describe('createPerformanceEventProcessor', () => {
  it('rejects a non-performance event as a local precondition without touching the store', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>();
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({ event: { eventType: 'error' } as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
  });

  it('returns processed when the aggregate contribution is applied for an lcp event', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('maps an aggregate duplicate to processed (idempotent success)', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('duplicate'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('maps an aggregate invalid_input to dead-letter', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('invalid_input'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('maps an aggregate temporarily_unavailable to retry with a bounded availableAt', async () => {
    const persistMetric = vi
      .fn<PersistPerformanceMetricFn>()
      .mockResolvedValue(metricResult('temporarily_unavailable'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result.outcome).toBe('retry');
    if (result.outcome === 'retry') {
      expect(result.errorCode).toBe('service_temporarily_unavailable');
      expect(result.availableAt.getTime()).toBe(NOW.getTime() + 50);
    }
  });

  it('propagates a store unknown exception', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockRejectedValue(new Error('store-boom'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(processor.process(validInput(), new AbortController().signal)).rejects.toThrow(
      'store-boom',
    );
  });

  it('constructs the metric contribution with parsed fields for lcp/inp/cls/page_load', async () => {
    const args: PerformanceMetricContributionInput[] = [];
    const persistMetric: PersistPerformanceMetricFn = vi
      .fn<PersistPerformanceMetricFn>()
      .mockImplementation((input) => {
        args.push(input);
        return Promise.resolve(metricResult('applied'));
      });
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: performanceEnvelope('evt-perf-inp', { metricName: 'inp', value: 320, unit: 'millisecond' }) as ProcessIngestionEventInput['event'],
    });
    await processor.process(input, new AbortController().signal);
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({
      projectId: input.projectId,
      eventId: 'evt-perf-inp',
      occurredAt: 1_800_000_054_000,
      metricName: 'inp',
      unit: 'millisecond',
      value: 320,
      startedAt: 1_800_000_050_000,
    });
  });

  it('includes durationMs in the contribution when present', async () => {
    const args: PerformanceMetricContributionInput[] = [];
    const persistMetric: PersistPerformanceMetricFn = vi
      .fn<PersistPerformanceMetricFn>()
      .mockImplementation((input) => {
        args.push(input);
        return Promise.resolve(metricResult('applied'));
      });
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: performanceEnvelope('evt-perf-dur', { durationMs: 300 }) as ProcessIngestionEventInput['event'],
    });
    await processor.process(input, new AbortController().signal);
    expect(args[0]?.durationMs).toBe(300);
  });

  it('never calls persistPerformanceEventSample (V1 does not persist diagnostic samples)', async () => {
    const sampleSpy = vi.fn(persistPerformanceEventSample);
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await processor.process(validInput(), new AbortController().signal);
    expect(sampleSpy).not.toHaveBeenCalled();
  });

  it('aggregates deterministically without any server-side sampling', async () => {
    const args: PerformanceMetricContributionInput[] = [];
    const persistMetric: PersistPerformanceMetricFn = vi
      .fn<PersistPerformanceMetricFn>()
      .mockImplementation((input) => {
        args.push(input);
        return Promise.resolve(metricResult('applied'));
      });
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    // Two distinct valid events both aggregate (no probabilistic dropping).
    await processor.process(
      validInput({ event: performanceEnvelope('evt-perf-a') as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    await processor.process(
      validInput({ event: performanceEnvelope('evt-perf-b') as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    expect(args).toHaveLength(2);
  });

  it('rejects an unknown performance metric name via the parser', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>();
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({
        event: performanceEnvelope('evt-perf-fcp', { metricName: 'fcp' }) as ProcessIngestionEventInput['event'],
      }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
  });

  it('rejects a malformed performance envelope without touching the store', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>();
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({ event: { protocolVersion: 1, eventId: 'evt-bad', eventType: 'performance', occurredAt: 1, body: { metricName: 'lcp', value: 'bad', unit: 'millisecond', startedAt: 1 } } }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
  });

  it('does not modify its input object', async () => {
    const processor = createPerformanceEventProcessor({
      persistMetric: vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied')),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput();
    const snapshot = {
      inboxId: input.inboxId,
      projectId: input.projectId,
      eventId: input.eventId,
      event: input.event,
      attemptCount: input.attemptCount,
      leaseId: input.leaseId,
      leaseExpiresAt: input.leaseExpiresAt.getTime(),
    };
    await processor.process(input, new AbortController().signal);
    expect(input.inboxId).toBe(snapshot.inboxId);
    expect(input.projectId).toBe(snapshot.projectId);
    expect(input.eventId).toBe(snapshot.eventId);
    expect(input.event).toEqual(snapshot.event);
    expect(input.attemptCount).toBe(snapshot.attemptCount);
    expect(input.leaseId).toBe(snapshot.leaseId);
    expect(input.leaseExpiresAt.getTime()).toBe(snapshot.leaseExpiresAt);
  });

  it('records only stable diagnostic codes, never event bodies', async () => {
    const { diagnostics, codes } = recordingDiagnostics();
    const processor = createPerformanceEventProcessor({
      persistMetric: vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied')),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
      diagnostics,
    });
    await processor.process(validInput(), new AbortController().signal);
    expect(codes).toContain('performance_applied');
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  it('throws a stable error on an invalid backoff configuration instead of silent downgrade', async () => {
    const processor = createPerformanceEventProcessor({
      persistMetric: vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('temporarily_unavailable')),
      backoff: { initialDelayMs: 0, maxDelayMs: 1000 },
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(processor.process(validInput(), new AbortController().signal)).rejects.toThrow(
      'invalid retry backoff configuration',
    );
  });
});
