import {
  CURRENT_PROTOCOL_VERSION,
  EventType,
  parseEventEnvelope,
  parseIngestionBatchRequest,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

const validEvent = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-batch-valid-001',
  eventType: EventType.Error,
  occurredAt: 1_800_000_005_100,
  body: {},
};

describe('parseIngestionBatchRequest', () => {
  it('parses a minimal valid batch with one event', () => {
    const input = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [validEvent],
    };
    const result = parseIngestionBatchRequest(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
    expect(result.data.events).toHaveLength(1);
    const envelope = parseEventEnvelope(validEvent);
    expect(envelope.success).toBe(true);
    if (!envelope.success) return;
    expect(result.data.events[0]).toEqual(envelope.data);
  });
  it('parses a full valid batch with receivedAt', () => {
    const input = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [validEvent, { ...validEvent, eventId: 'evt-batch-valid-002' }],
      receivedAt: 1_800_000_005_200,
    };
    const result = parseIngestionBatchRequest(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.events).toHaveLength(2);
    expect(result.data.receivedAt).toBe(1_800_000_005_200);
  });
  it('rejects an empty events array as missing required field', () => {
    const result = parseIngestionBatchRequest({
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [],
    });
    expect(result.success).toBe(false);
  });
  it('rejects unsupported protocol version', () => {
    const result = parseIngestionBatchRequest({
      protocolVersion: 2,
      events: [validEvent],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some((i) => i.code === 'unsupported_protocol_version')).toBe(true);
  });
  it('does not mutate the input', () => {
    const input = {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      events: [validEvent],
    };
    const snapshot = JSON.stringify(input);
    parseIngestionBatchRequest(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
