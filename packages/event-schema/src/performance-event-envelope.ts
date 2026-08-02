import { parsePerformanceEventBody } from './performance-event-body.js';
import type { PerformanceEventEnvelopeParseResult } from './performance-event-types.js';
import { parseEventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';

function unsafeEnvelopeFailure(): PerformanceEventEnvelopeParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: [],
        message: 'Performance event envelope could not be read safely',
      },
    ],
  };
}

function parseEnvelope(input: unknown): PerformanceEventEnvelopeParseResult {
  const envelopeResult = parseEventEnvelope(input);
  if (!envelopeResult.success) return envelopeResult;
  if (envelopeResult.data.eventType !== EventType.Performance) {
    return {
      success: false,
      issues: [
        {
          code: 'event_type_mismatch',
          path: ['eventType'],
          message: 'Performance event body requires the performance event type',
        },
      ],
    };
  }
  const bodyResult = parsePerformanceEventBody(envelopeResult.data.body);
  if (!bodyResult.success) return bodyResult;
  return {
    success: true,
    data: {
      protocolVersion: envelopeResult.data.protocolVersion,
      eventId: envelopeResult.data.eventId,
      eventType: EventType.Performance,
      occurredAt: envelopeResult.data.occurredAt,
      body: bodyResult.data,
    },
  };
}

export function parsePerformanceEventEnvelope(input: unknown): PerformanceEventEnvelopeParseResult {
  try {
    return parseEnvelope(input);
  } catch {
    return unsafeEnvelopeFailure();
  }
}
