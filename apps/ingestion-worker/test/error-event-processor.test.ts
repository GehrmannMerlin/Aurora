import { describe, expect, it, vi } from 'vitest';
import {
  createErrorEventProcessor,
  mapPersistResultToWorkerResult,
  type ErrorEventProcessorDiagnostics,
  type PersistErrorEventOccurrenceFn,
} from '../src/error-event-processor.js';
import type { ProcessIngestionEventInput } from '../src/processor.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from '../src/retry-backoff-types.js';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

function zeroEntropy(): RetryBackoffEntropyProvider {
  return { next: () => 0 };
}

function validInput(overrides?: Partial<ProcessIngestionEventInput>): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-1',
    event: {
      protocolVersion: 1,
      eventId: 'evt-1',
      eventType: 'error',
      occurredAt: 1_800_000_000_000,
      body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
    },
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-03T00:01:00.000Z'),
    ...overrides,
  };
}

function recordingDiagnostics(): { diagnostics: ErrorEventProcessorDiagnostics; codes: string[] } {
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

describe('createErrorEventProcessor', () => {
  it('returns processed when the store reports inserted', async () => {
    const store: PersistErrorEventOccurrenceFn = vi.fn().mockResolvedValue({
      status: 'inserted',
      occurrenceId: '7',
    });
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
    expect(store).toHaveBeenCalledWith({
      projectId: validInput().projectId,
      eventEnvelope: validInput().event,
    });
  });

  it('returns processed on duplicate (idempotent success)', async () => {
    const store: PersistErrorEventOccurrenceFn = vi
      .fn()
      .mockResolvedValue({ status: 'duplicate' });
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('returns dead-letter with invalid_event_type on invalid_input', async () => {
    const store: PersistErrorEventOccurrenceFn = vi
      .fn()
      .mockResolvedValue({ status: 'invalid_input', code: 'invalid_envelope' });
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('returns retry with a backoff availableAt on temporarily_unavailable', async () => {
    const store: PersistErrorEventOccurrenceFn = vi
      .fn()
      .mockResolvedValue({ status: 'temporarily_unavailable' });
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result.outcome).toBe('retry');
    if (result.outcome === 'retry') {
      expect(result.errorCode).toBe('service_temporarily_unavailable');
      // attemptCount=1, entropy=0 => delay = ceil(100/2) = 50ms
      expect(result.availableAt.getTime()).toBe(NOW.getTime() + 50);
    }
  });

  it('throws a stable error when backoff configuration is invalid (program defect)', async () => {
    const store: PersistErrorEventOccurrenceFn = vi
      .fn()
      .mockResolvedValue({ status: 'temporarily_unavailable' });
    const invalidBackoff: RetryBackoffConfig = { initialDelayMs: -1, maxDelayMs: 1000 };
    const processor = createErrorEventProcessor({
      persist: store,
      backoff: invalidBackoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(processor.process(validInput(), new AbortController().signal)).rejects.toThrow(
      'invalid retry backoff configuration',
    );
  });

  it('rejects a non-error envelope as a local precondition', async () => {
    const store: PersistErrorEventOccurrenceFn = vi.fn();
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: {
        protocolVersion: 1,
        eventId: 'evt-request',
        eventType: 'request',
        occurredAt: 1_800_000_000_000,
        body: { method: 'GET', url: 'https://api.example.test/items', startedAt: 1_800_000_000_000, durationMs: 120, outcome: 'success' },
      },
    });
    const result = await processor.process(input, new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(store).not.toHaveBeenCalled();
  });

  it('propagates unknown exceptions from the store', async () => {
    const store: PersistErrorEventOccurrenceFn = vi
      .fn()
      .mockRejectedValue(new Error('database exploded'));
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(processor.process(validInput(), new AbortController().signal)).rejects.toThrow(
      'database exploded',
    );
  });

  it('records stable diagnostics without the event body', async () => {
    const store: PersistErrorEventOccurrenceFn = vi.fn().mockResolvedValue({
      status: 'inserted',
      occurrenceId: '7',
    });
    const { diagnostics, codes } = recordingDiagnostics();
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
      diagnostics,
    });
    await processor.process(validInput(), new AbortController().signal);
    expect(codes).toContain('occurrence_persisted');
  });

  it('does not mutate the input event', async () => {
    const store: PersistErrorEventOccurrenceFn = vi.fn().mockResolvedValue({
      status: 'inserted',
      occurrenceId: '7',
    });
    const processor = createErrorEventProcessor({
      persist: store,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput();
    const snapshot = structuredClone(input);
    await processor.process(input, new AbortController().signal);
    expect(input).toEqual(snapshot);
  });
});

describe('mapPersistResultToWorkerResult', () => {
  it('maps inserted to processed', () => {
    expect(mapPersistResultToWorkerResult({ status: 'inserted', occurrenceId: '7' })).toEqual({
      outcome: 'processed',
    });
  });

  it('maps duplicate to processed (idempotent success)', () => {
    expect(mapPersistResultToWorkerResult({ status: 'duplicate' })).toEqual({
      outcome: 'processed',
    });
  });

  it('maps invalid_input to dead-letter with invalid_event_type', () => {
    expect(
      mapPersistResultToWorkerResult({ status: 'invalid_input', code: 'invalid_envelope' }),
    ).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('throws for temporarily_unavailable (not a terminal outcome)', () => {
    expect(() =>
      mapPersistResultToWorkerResult({ status: 'temporarily_unavailable' }),
    ).toThrow();
  });
});
