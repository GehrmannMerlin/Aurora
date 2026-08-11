import { describe, expect, it } from 'vitest';
import {
  createSdkDeliveryQueue,
  DEFAULT_DELIVERY_QUEUE_CAPACITY,
} from '../src/index.js';

function errorEnvelope(eventId: string) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt: 1_800_000_000_000,
    body: { message: 'boom' },
  };
}
function requestEnvelope(eventId: string) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'request',
    occurredAt: 1_800_000_000_000,
    body: {
      method: 'GET',
      url: 'https://api.test/x',
      startedAt: 1,
      durationMs: 100,
      outcome: 'success',
      statusCode: 200,
    },
  };
}
function performanceEnvelope(eventId: string) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_000_000,
    body: { metricName: 'lcp', unit: 'millisecond', value: 100 },
  };
}

describe('createSdkDeliveryQueue', () => {
  it('defaults to a bounded capacity', () => {
    const queue = createSdkDeliveryQueue();
    expect(queue.capacity).toBe(DEFAULT_DELIVERY_QUEUE_CAPACITY);
  });

  it('enqueues and drains events', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    expect(queue.enqueue(errorEnvelope('e1'), 1000).code).toBe('enqueued');
    expect(queue.enqueue(requestEnvelope('r1'), 1001).code).toBe('enqueued');
    expect(queue.size).toBe(2);
    const drained = queue.drain(10);
    expect(drained.map((i) => i.envelope.eventId).join(',')).toBe('e1,r1');
    expect(queue.size).toBe(0);
  });

  it('rejects duplicate event IDs already in queue', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    expect(queue.enqueue(errorEnvelope('e1'), 1000).code).toBe('enqueued');
    expect(queue.enqueue(errorEnvelope('e1'), 1001).code).toBe('duplicate');
    expect(queue.size).toBe(1);
  });

  it('rejects invalid envelopes without throwing', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    expect(queue.enqueue({ eventId: 123 }, 1000).code).toBe('invalid_envelope');
    expect(queue.enqueue(null, 1000).code).toBe('invalid_envelope');
    expect(
      queue.enqueue(
        { protocolVersion: 1, eventId: '', eventType: 'error', occurredAt: 1, body: {} },
        1000,
      ).code,
    ).toBe('invalid_envelope');
    expect(queue.enqueue({ eventId: 'x', eventType: 'not-a-type' }, 1000).code).toBe('invalid_envelope');
  });

  it('drains error events before lower-priority events', () => {
    const queue = createSdkDeliveryQueue({ capacity: 10 });
    queue.enqueue(performanceEnvelope('p1'), 1000);
    queue.enqueue(requestEnvelope('r1'), 1001);
    queue.enqueue(errorEnvelope('e1'), 1002);
    queue.enqueue(errorEnvelope('e2'), 1003);
    expect(queue.drain(10).map((i) => i.envelope.eventId).join(',')).toBe('e1,e2,p1,r1');
  });

  it('respects drain max batch size', () => {
    const queue = createSdkDeliveryQueue({ capacity: 10 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.enqueue(errorEnvelope('e2'), 1001);
    queue.enqueue(errorEnvelope('e3'), 1002);
    const first = queue.drain(2);
    expect(first.map((i) => i.envelope.eventId)).toEqual(['e1', 'e2']);
    expect(queue.size).toBe(1);
    expect(queue.drain(2).map((i) => i.envelope.eventId)).toEqual(['e3']);
  });

  it('keeps memory bounded: on overflow admits error by evicting oldest low-priority', () => {
    const queue = createSdkDeliveryQueue({ capacity: 3 });
    queue.enqueue(performanceEnvelope('p1'), 1000);
    queue.enqueue(requestEnvelope('r1'), 1001);
    queue.enqueue(requestEnvelope('r2'), 1002);
    expect(queue.size).toBe(3);
    const result = queue.enqueue(errorEnvelope('e1'), 1003);
    expect(result.code).toBe('enqueued');
    expect(result.evictedEventId).toBe('p1');
    expect(queue.size).toBe(3);
    expect(queue.drain(10).map((i) => i.envelope.eventId).join(',')).toBe('e1,r1,r2');
  });

  it('drops a low-priority incoming event when the queue is full', () => {
    const queue = createSdkDeliveryQueue({ capacity: 2 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.enqueue(errorEnvelope('e2'), 1001);
    const result = queue.enqueue(performanceEnvelope('p1'), 1002);
    expect(result.code).toBe('queue_full');
    expect(queue.size).toBe(2);
  });

  it('reenqueue keeps the same event ID and increments attemptCount', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    const drained = queue.drain(1);
    expect(drained).toHaveLength(1);
    const item = drained[0];
    if (item === undefined) return;
    expect(item.envelope.eventId).toBe('e1');
    const retry = { envelope: item.envelope, attemptCount: 1, enqueuedAt: 2000 };
    expect(queue.reenqueue(retry, 2000).code).toBe('enqueued');
    const redrained = queue.drain(1);
    expect(redrained).toHaveLength(1);
    expect(redrained[0]?.attemptCount).toBe(1);
  });

  it('clear removes all events and resets dedup', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(errorEnvelope('e1'), 2000).code).toBe('enqueued');
  });

  it('destroy releases state and rejects further work', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.destroy();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(errorEnvelope('e2'), 2000).code).toBe('destroyed');
    expect(queue.drain(10)).toEqual([]);
  });

  it('isolates instances (no shared mutable state)', () => {
    const a = createSdkDeliveryQueue({ capacity: 2 });
    const b = createSdkDeliveryQueue({ capacity: 2 });
    a.enqueue(errorEnvelope('e1'), 1000);
    expect(b.size).toBe(0);
    b.enqueue(errorEnvelope('e1'), 1000);
    a.destroy();
    expect(b.enqueue(errorEnvelope('e2'), 2000).code).toBe('enqueued');
  });
});
