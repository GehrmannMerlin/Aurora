import { describe, expect, it } from 'vitest';
import {
  BATCH_EVENT_LIMITS,
  CURRENT_PROTOCOL_VERSION,
  type EventEnvelope,
} from '@aurora/event-schema';
import { buildDeliveryBatch } from '../src/index.js';

function envelope(eventId: string): EventEnvelope {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt: 1_800_000_000_000,
    body: { message: 'x' },
  };
}

describe('buildDeliveryBatch', () => {
  it('builds a valid batch from envelopes', () => {
    const events = [envelope('e1'), envelope('e2')];
    const result = buildDeliveryBatch(events, 1_800_000_100_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.batch.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
    expect(result.batch.events.map((e) => e.eventId)).toEqual(['e1', 'e2']);
    expect(result.batch.receivedAt).toBe(1_800_000_100_000);
  });

  it('omits receivedAt when it is not a positive safe integer', () => {
    const result = buildDeliveryBatch([envelope('e1')], 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('receivedAt' in result.batch).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(buildDeliveryBatch([], 1)).toEqual({ ok: false, code: 'empty' });
  });

  it('rejects more than maxEventsPerBatch events', () => {
    const events = Array.from(
      { length: BATCH_EVENT_LIMITS.maxEventsPerBatch + 1 },
      (_, i) => envelope(`e${i}`),
    );
    expect(buildDeliveryBatch(events, 1)).toEqual({ ok: false, code: 'too_many_events' });
  });

  it('freezes the produced batch and events array', () => {
    const result = buildDeliveryBatch([envelope('e1')], 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.batch)).toBe(true);
    expect(Object.isFrozen(result.batch.events)).toBe(true);
  });
});
