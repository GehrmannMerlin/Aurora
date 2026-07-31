import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import type { EventEnvelope } from '../event-envelope.js';
import { EventType } from '../event-types.js';

export const validEventEnvelopeSamples: readonly EventEnvelope[] = [
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-error-synthetic-001',
    eventType: EventType.Error,
    occurredAt: 1_800_000_000_001,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-request-synthetic-001',
    eventType: EventType.Request,
    occurredAt: 1_800_000_000_002,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-performance-synthetic-001',
    eventType: EventType.Performance,
    occurredAt: 1_800_000_000_003,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-resource-synthetic-001',
    eventType: EventType.Resource,
    occurredAt: 1_800_000_000_004,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-compatible-old-shape',
    eventType: EventType.Error,
    occurredAt: 1_800_000_000_005,
    body: {},
  },
  {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-compatible-new-shape',
    eventType: EventType.Error,
    occurredAt: 1_800_000_000_006,
    body: { optionalContext: { attempt: 1 } },
  },
];
