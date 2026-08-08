import { describe, expect, it, vi } from 'vitest';
import { EventType } from '@aurora/event-schema';
import {
  createEventProcessorRouter,
  type EventProcessorRouterDiagnostics,
} from '../src/event-processor-router.js';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from '../src/processor.js';

function fakeProcessor(
  handler: (
    input: ProcessIngestionEventInput,
  ) => ProcessIngestionEventResult | Promise<ProcessIngestionEventResult>,
): {
  processor: IngestionEventProcessor;
  calledWith: ProcessIngestionEventInput[];
} {
  const calledWith: ProcessIngestionEventInput[] = [];
  const processor: IngestionEventProcessor = {
    process: vi.fn((input: ProcessIngestionEventInput, signal: AbortSignal) => {
      void signal;
      calledWith.push(input);
      return Promise.resolve(handler(input));
    }),
  };
  return { processor, calledWith };
}

function envelope(eventType: string, eventId = 'evt-1'): unknown {
  return { protocolVersion: 1, eventId, eventType, occurredAt: 1_800_000_054_000, body: {} };
}

function input(eventType: string): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-1',
    event: envelope(eventType) as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
  };
}

function recordingDiagnostics(): { diagnostics: EventProcessorRouterDiagnostics; codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    diagnostics: { record: (entry) => { codes.push(entry.code); } },
  };
}

describe('createEventProcessorRouter', () => {
  it('routes an error event to the error processor and propagates its result', async () => {
    const { processor: errorProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('routes a request event to the request processor', async () => {
    const { processor: requestProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ requestProcessor });
    const result = await router.process(input(EventType.Request), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('routes a performance event to the performance processor', async () => {
    const { processor: performanceProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ performanceProcessor });
    const result = await router.process(input(EventType.Performance), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('propagates a retry result verbatim', async () => {
    const { processor: errorProcessor } = fakeProcessor(() => ({
      outcome: 'retry' as const,
      availableAt: new Date('2026-08-07T00:01:00.000Z'),
      errorCode: 'service_temporarily_unavailable' as const,
    }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({
      outcome: 'retry',
      availableAt: new Date('2026-08-07T00:01:00.000Z'),
      errorCode: 'service_temporarily_unavailable',
    });
  });

  it('propagates a dead-letter result verbatim', async () => {
    const { processor: errorProcessor } = fakeProcessor(() => ({
      outcome: 'dead-letter' as const,
      errorCode: 'invalid_event_type' as const,
    }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('rejects a resource event with dead-letter without calling any processor', async () => {
    const { processor: errorProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const { processor: requestProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const { processor: performanceProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor, requestProcessor, performanceProcessor });
    const result = await router.process(input(EventType.Resource), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('rejects an unknown event type with dead-letter', async () => {
    const { processor: errorProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input('behavior'), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('rejects a missing processor for a routed type with dead-letter', async () => {
    const router = createEventProcessorRouter({});
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('propagates a processor exception without catching', async () => {
    const { processor: errorProcessor } = fakeProcessor(() => {
      throw new Error('processor-boom');
    });
    const router = createEventProcessorRouter({ errorProcessor });
    await expect(router.process(input(EventType.Error), new AbortController().signal)).rejects.toThrow(
      'processor-boom',
    );
  });

  it('calls only the processor matching the event type', async () => {
    const { processor: errorProcessor, calledWith: errorCalls } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const { processor: requestProcessor, calledWith: requestCalls } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor, requestProcessor });
    await router.process(input(EventType.Error), new AbortController().signal);
    expect(errorCalls).toHaveLength(1);
    expect(requestCalls).toHaveLength(0);
  });

  it('records only stable diagnostic codes, never event bodies', async () => {
    const { diagnostics, codes } = recordingDiagnostics();
    const { processor: errorProcessor } = fakeProcessor(() => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor, diagnostics });
    await router.process(input(EventType.Error), new AbortController().signal);
    expect(codes).toContain('routed_error');
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });
});
