import { describe, expect, it } from 'vitest';
import {
  IngestionErrorCode,
  IngestionReceiptState,
  type EventEnvelope,
  type IngestionRequestReceipt,
} from '@aurora/event-schema';
import {
  createSdkDeliveryChain,
  type SdkBatchTransport,
} from '../src/index.js';

function errorEnvelope(eventId: string): EventEnvelope {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt: 1_800_000_000_000,
    body: { message: 'boom' },
  };
}

function receiptFor(
  events: readonly EventEnvelope[],
  states: readonly string[],
): IngestionRequestReceipt {
  const hasTemporary = states.includes('temporarily_failed');
  const batchState = hasTemporary
    ? IngestionReceiptState.TemporarilyFailed
    : states.includes('permanently_rejected')
      ? IngestionReceiptState.PermanentlyRejected
      : IngestionReceiptState.Accepted;
  return {
    batchState,
    retryable: hasTemporary,
    perEventResults: events.map((e, i) => {
      const state = states[i] ?? 'accepted';
      return {
        eventId: e.eventId,
        state: state as IngestionRequestReceipt['perEventResults'][number]['state'],
        ...(state === 'permanently_rejected' ? { errorCode: IngestionErrorCode.InvalidSchema } : {}),
        retryable: state === 'temporarily_failed',
      };
    }),
  };
}

function successTransport(): SdkBatchTransport {
  return {
    send: async (request) => ({
      kind: 'success',
      status: 200,
      receipt: receiptFor(request.events, request.events.map(() => 'accepted')),
    }),
  };
}

describe('createSdkDeliveryChain', () => {
  it('sends an enqueued batch and removes accepted events', async () => {
    const sent: string[][] = [];
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async (request) => {
            sent.push(request.events.map((e) => e.eventId));
            return { kind: 'success', status: 200, receipt: receiptFor(request.events, request.events.map(() => 'accepted')) };
          },
        },
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    expect(chain.enqueue(errorEnvelope('e1')).code).toBe('enqueued');
    const result = await chain.flush();
    expect(sent).toEqual([['e1']]);
    expect(result.eventsSent).toBe(1);
    expect(chain.size).toBe(0);
  });

  it('retries a network failure up to maxRetries then drops', async () => {
    let sends = 0;
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async () => {
            sends += 1;
            return { kind: 'transport_failure', reason: 'network' };
          },
        },
        maxRetries: 2,
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(sends).toBe(3); // first send + 2 retries
    expect(result.eventsSent).toBe(0);
    expect(result.eventsDropped).toBe(1);
    expect(chain.size).toBe(0);
  });

  it('does NOT retry a non-retryable HTTP rejection', async () => {
    let sends = 0;
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async () => {
            sends += 1;
            return { kind: 'http_error', status: 401 };
          },
        },
        maxRetries: 3,
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(sends).toBe(1);
    expect(result.eventsDropped).toBe(1);
    expect(chain.getDiagnostics().some((d) => d.code === 'batch_dropped')).toBe(true);
  });

  it('handles a partial receipt per-event: accepted done, permanent dropped, temporary retried', async () => {
    const sent: string[][] = [];
    const attempts: Record<string, number> = {};
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async (request) => {
            sent.push(request.events.map((e) => e.eventId));
            const states = request.events.map((e) => {
              const count = (attempts[e.eventId] ?? 0) + 1;
              attempts[e.eventId] = count;
              if (e.eventId === 'bad') return 'permanently_rejected';
              if (e.eventId === 'retry' && count === 1) return 'temporarily_failed';
              return 'accepted';
            });
            return { kind: 'success', status: 200, receipt: receiptFor(request.events, states) };
          },
        },
        maxRetries: 2,
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.enqueue(errorEnvelope('ok'));
    chain.enqueue(errorEnvelope('bad'));
    chain.enqueue(errorEnvelope('retry'));
    const result = await chain.flush();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.sort()).toEqual(['bad', 'ok', 'retry']);
    expect(sent[1]).toEqual(['retry']);
    expect(result.eventsDropped).toBe(1); // only 'bad'
    expect(chain.size).toBe(0);
  });

  it('flush is controllable and terminates', async () => {
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: successTransport(),
        maxRetries: 1,
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(result.ok).toBe(true);
  });

  it('transport exceptions never escape to the caller', async () => {
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async () => {
            throw new Error('boom');
          },
        },
        maxRetries: 1,
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(result.ok).toBe(true);
    expect(chain.getDiagnostics().some((d) => d.code === 'transport_failure')).toBe(true);
  });

  it('best-effort flush sends once without retry', async () => {
    let sends = 0;
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async () => {
            sends += 1;
            return { kind: 'transport_failure', reason: 'network' };
          },
        },
        maxRetries: 3,
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush({ bestEffort: true });
    expect(sends).toBe(1);
    expect(result.eventsDropped).toBe(1);
    expect(chain.size).toBe(0);
  });

  it('destroys and rejects further enqueue', async () => {
    const chain = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: successTransport(),
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    chain.destroy();
    expect(chain.enqueue(errorEnvelope('e1')).code).toBe('destroyed');
    const result = await chain.flush();
    expect(result.ok).toBe(false);
  });

  it('isolates instances', async () => {
    const sentA: string[][] = [];
    const a = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: {
          send: async (request) => {
            sentA.push(request.events.map((e) => e.eventId));
            return { kind: 'success', status: 200, receipt: receiptFor(request.events, request.events.map(() => 'accepted')) };
          },
        },
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    const b = createSdkDeliveryChain(
      { clientKey: 'k', environment: null },
      {
        transport: successTransport(),
        schedule: (fn) => fn(),
        now: () => 1_000,
        entropy: () => 0,
      },
    );
    a.enqueue(errorEnvelope('e1'));
    await a.flush();
    expect(sentA).toEqual([['e1']]);
    expect(b.size).toBe(0);
  });
});
