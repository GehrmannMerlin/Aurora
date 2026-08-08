import { describe, expect, it, vi } from 'vitest';
import type {
  PersistRequestEventSampleResult,
  PersistRequestMetricContributionResult,
  RequestMetricContributionInput,
} from '@aurora/processing-store';
import {
  createRequestEventProcessor,
  type ClassifyRequestEvent,
  type PersistRequestMetricFn,
  type PersistRequestSampleFn,
  type RequestEventClassification,
  type RequestEventProcessorDiagnostics,
} from '../src/request-event-processor.js';
import type { ProcessIngestionEventInput } from '../src/processor.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from '../src/retry-backoff-types.js';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

function zeroEntropy(): RetryBackoffEntropyProvider {
  return { next: () => 0 };
}

function requestEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'request',
    occurredAt: 1_800_000_000_000,
    body: {
      method: 'GET',
      url: 'https://api.example.test/items',
      startedAt: 1_800_000_000_000,
      durationMs: 120,
      outcome: 'success',
      ...bodyOverrides,
    },
  };
}

function validInput(overrides?: Partial<ProcessIngestionEventInput>): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-1',
    event: requestEnvelope('evt-1') as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-03T00:01:00.000Z'),
    ...overrides,
  };
}

function classification(
  overrides?: Partial<RequestEventClassification>,
): RequestEventClassification {
  return { isFailure: false, isSlow: false, isAdditionalMonitoredStatus: false, ...overrides };
}

function metricResult(
  status: PersistRequestMetricContributionResult['status'],
): PersistRequestMetricContributionResult {
  return status === 'applied'
    ? { status: 'applied' }
    : status === 'duplicate'
      ? { status: 'duplicate' }
      : status === 'invalid_input'
        ? { status: 'invalid_input', code: 'invalid_outcome' }
        : { status: 'temporarily_unavailable' };
}

function sampleResult(
  status: PersistRequestEventSampleResult['status'],
): PersistRequestEventSampleResult {
  return status === 'inserted'
    ? { status: 'inserted', sampleId: '7' }
    : status === 'duplicate'
      ? { status: 'duplicate' }
      : status === 'invalid_input'
        ? { status: 'invalid_input', code: 'invalid_request_event' }
        : { status: 'temporarily_unavailable' };
}

function recordingDiagnostics(): {
  diagnostics: RequestEventProcessorDiagnostics;
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

describe('createRequestEventProcessor', () => {
  it('rejects a non-request event as a local precondition without touching either store', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>();
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const classify: ClassifyRequestEvent = vi.fn().mockResolvedValue(classification());
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({ event: { eventType: 'error' } as ProcessIngestionEventInput['event'] });
    const result = await processor.process(input, new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
    expect(persistSample).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it('returns processed when metric applied and selection skips, without calling sample store', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied'));
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const classify: ClassifyRequestEvent = vi.fn().mockResolvedValue(classification());
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
    expect(persistSample).not.toHaveBeenCalled();
  });

  it('returns processed when metric duplicate and selection skips', async () => {
    const persistMetric = vi
      .fn<PersistRequestMetricFn>()
      .mockResolvedValue(metricResult('duplicate'));
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification()),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
    expect(persistSample).not.toHaveBeenCalled();
  });

  it('maps metric invalid_input to dead-letter without calling sample store', async () => {
    const persistMetric = vi
      .fn<PersistRequestMetricFn>()
      .mockResolvedValue(metricResult('invalid_input'));
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification()),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistSample).not.toHaveBeenCalled();
  });

  it('maps metric temporarily_unavailable to retry without calling sample store', async () => {
    const persistMetric = vi
      .fn<PersistRequestMetricFn>()
      .mockResolvedValue(metricResult('temporarily_unavailable'));
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification()),
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
    expect(persistSample).not.toHaveBeenCalled();
  });

  it('returns processed when metric applied and sample inserted', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied'));
    const persistSample = vi
      .fn<PersistRequestSampleFn>()
      .mockResolvedValue(sampleResult('inserted'));
    const classify: ClassifyRequestEvent = vi.fn().mockResolvedValue(
      classification({ isFailure: true, isSlow: false, isAdditionalMonitoredStatus: false }),
    );
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
    });
    const result = await processor.process(input, new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
    expect(persistSample).toHaveBeenCalledWith({
      projectId: input.projectId,
      eventEnvelope: input.event,
    });
  });

  it('returns processed when metric duplicate and sample duplicate (idempotent success)', async () => {
    const persistMetric = vi
      .fn<PersistRequestMetricFn>()
      .mockResolvedValue(metricResult('duplicate'));
    const persistSample = vi
      .fn<PersistRequestSampleFn>()
      .mockResolvedValue(sampleResult('duplicate'));
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({
        event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
      }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('maps sample invalid_input to dead-letter', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied'));
    const persistSample = vi
      .fn<PersistRequestSampleFn>()
      .mockResolvedValue(sampleResult('invalid_input'));
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({
        event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
      }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('maps sample temporarily_unavailable to retry', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied'));
    const persistSample = vi
      .fn<PersistRequestSampleFn>()
      .mockResolvedValue(sampleResult('temporarily_unavailable'));
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({
        event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
      }),
      new AbortController().signal,
    );
    expect(result.outcome).toBe('retry');
    if (result.outcome === 'retry') {
      expect(result.errorCode).toBe('service_temporarily_unavailable');
      expect(result.availableAt.getTime()).toBe(NOW.getTime() + 50);
    }
  });

  it('propagates a metric unknown exception', async () => {
    const persistMetric = vi
      .fn<PersistRequestMetricFn>()
      .mockRejectedValue(new Error('metric-boom'));
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification()),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(
      processor.process(validInput(), new AbortController().signal),
    ).rejects.toThrow('metric-boom');
    expect(persistSample).not.toHaveBeenCalled();
  });

  it('propagates a sample unknown exception', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied'));
    const persistSample = vi
      .fn<PersistRequestSampleFn>()
      .mockRejectedValue(new Error('sample-boom'));
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(
      processor.process(
        validInput({
          event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
        }),
        new AbortController().signal,
      ),
    ).rejects.toThrow('sample-boom');
  });

  it('propagates a classifier unknown exception without touching either store', async () => {
    const persistMetric = vi.fn<PersistRequestMetricFn>();
    const persistSample = vi.fn<PersistRequestSampleFn>();
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockRejectedValue(new Error('classify-boom')),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(
      processor.process(validInput(), new AbortController().signal),
    ).rejects.toThrow('classify-boom');
    expect(persistMetric).not.toHaveBeenCalled();
    expect(persistSample).not.toHaveBeenCalled();
  });

  it('passes only safe minimal facts to the classifier, never sensitive fields', async () => {
    const captured: unknown[] = [];
    const classify: ClassifyRequestEvent = vi.fn().mockImplementation((input) => {
      captured.push(input);
      return Promise.resolve(classification());
    });
    const processor = createRequestEventProcessor({
      persistMetric: vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied')),
      persistSample: vi.fn<PersistRequestSampleFn>(),
      classify,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: requestEnvelope('evt-1', {
        outcome: 'http_error',
        statusCode: 404,
        durationMs: 500,
        method: 'POST',
      }) as ProcessIngestionEventInput['event'],
    });
    await processor.process(input, new AbortController().signal);
    expect(captured).toEqual([
      { outcome: 'http_error', statusCode: 404, durationMs: 500, method: 'POST' },
    ]);
  });

  it('constructs the metric contribution with classification booleans and parsed fields', async () => {
    const metricArgs: RequestMetricContributionInput[] = [];
    const persistMetric: PersistRequestMetricFn = vi
      .fn<PersistRequestMetricFn>()
      .mockImplementation((input) => {
        metricArgs.push(input);
        return Promise.resolve(metricResult('applied'));
      });
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample: vi
        .fn<PersistRequestSampleFn>()
        .mockResolvedValue(sampleResult('inserted')),
      classify: vi
        .fn<ClassifyRequestEvent>()
        .mockResolvedValue(classification({ isFailure: true, isSlow: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: requestEnvelope('evt-1', {
        outcome: 'http_error',
        statusCode: 503,
        durationMs: 2500,
        method: 'GET',
      }) as ProcessIngestionEventInput['event'],
    });
    await processor.process(input, new AbortController().signal);
    expect(metricArgs).toHaveLength(1);
    expect(metricArgs[0]).toMatchObject({
      projectId: input.projectId,
      eventId: 'evt-1',
      occurredAt: 1_800_000_000_000,
      method: 'GET',
      outcome: 'http_error',
      statusCode: 503,
      durationMs: 2500,
      isFailure: true,
      isSlow: true,
    });
  });

  it('throws a stable error on an invalid backoff configuration instead of silent downgrade', async () => {
    const processor = createRequestEventProcessor({
      persistMetric: vi
        .fn<PersistRequestMetricFn>()
        .mockResolvedValue(metricResult('temporarily_unavailable')),
      persistSample: vi.fn<PersistRequestSampleFn>(),
      classify: vi.fn().mockResolvedValue(classification()),
      backoff: { initialDelayMs: 0, maxDelayMs: 1000 },
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(
      processor.process(validInput(), new AbortController().signal),
    ).rejects.toThrow('invalid retry backoff configuration');
  });

  it('throws a stable error when the selection policy reports an invalid program input', async () => {
    const processor = createRequestEventProcessor({
      persistMetric: vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied')),
      persistSample: vi.fn<PersistRequestSampleFn>(),
      classify: vi.fn().mockResolvedValue({
        isFailure: false,
        isSlow: false,
        isAdditionalMonitoredStatus: 'yes' as unknown as boolean,
      }),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(
      processor.process(validInput(), new AbortController().signal),
    ).rejects.toThrow('invalid request sample selection input');
  });

  it('converges across retries when metric applied but sample temporarily unavailable', async () => {
    const persistMetric = vi
      .fn<PersistRequestMetricFn>()
      .mockResolvedValueOnce(metricResult('applied'))
      .mockResolvedValueOnce(metricResult('duplicate'));
    const persistSample = vi
      .fn<PersistRequestSampleFn>()
      .mockResolvedValueOnce(sampleResult('temporarily_unavailable'))
      .mockResolvedValueOnce(sampleResult('inserted'));
    const processor = createRequestEventProcessor({
      persistMetric,
      persistSample,
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
    });
    const first = await processor.process(input, new AbortController().signal);
    expect(first.outcome).toBe('retry');
    const second = await processor.process(input, new AbortController().signal);
    expect(second).toEqual({ outcome: 'processed' });
    expect(persistMetric).toHaveBeenCalledTimes(2);
    expect(persistSample).toHaveBeenCalledTimes(2);
  });

  it('does not modify its input object', async () => {
    const processor = createRequestEventProcessor({
      persistMetric: vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied')),
      persistSample: vi
        .fn<PersistRequestSampleFn>()
        .mockResolvedValue(sampleResult('inserted')),
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
    });
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
    const processor = createRequestEventProcessor({
      persistMetric: vi.fn<PersistRequestMetricFn>().mockResolvedValue(metricResult('applied')),
      persistSample: vi
        .fn<PersistRequestSampleFn>()
        .mockResolvedValue(sampleResult('inserted')),
      classify: vi.fn().mockResolvedValue(classification({ isFailure: true })),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
      diagnostics,
    });
    await processor.process(
      validInput({
        event: requestEnvelope('evt-1', { outcome: 'network_error' }) as ProcessIngestionEventInput['event'],
      }),
      new AbortController().signal,
    );
    expect(codes).toContain('metric_applied');
    expect(codes).toContain('sample_inserted');
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });
});
