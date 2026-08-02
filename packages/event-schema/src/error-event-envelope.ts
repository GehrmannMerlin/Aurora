import { parseErrorEventBody } from './error-event-body.js';
import type { ErrorEventEnvelopeParseResult } from './error-event-types.js';
import { parseEventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';

function unsafeEnvelopeFailure(): ErrorEventEnvelopeParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: [],
        message: 'Error event envelope could not be read safely',
      },
    ],
  };
}

function parseEnvelope(input: unknown): ErrorEventEnvelopeParseResult {
  const envelopeResult = parseEventEnvelope(input);
  if (!envelopeResult.success) return envelopeResult;
  if (envelopeResult.data.eventType !== EventType.Error) {
    return {
      success: false,
      issues: [
        {
          code: 'event_type_mismatch',
          path: ['eventType'],
          message: 'Error event body requires the error event type',
        },
      ],
    };
  }
  const bodyResult = parseErrorEventBody(envelopeResult.data.body);
  if (!bodyResult.success) return bodyResult;
  return {
    success: true,
    data: {
      protocolVersion: envelopeResult.data.protocolVersion,
      eventId: envelopeResult.data.eventId,
      eventType: EventType.Error,
      occurredAt: envelopeResult.data.occurredAt,
      body: bodyResult.data,
    },
  };
}

export function parseErrorEventEnvelope(input: unknown): ErrorEventEnvelopeParseResult {
  try {
    return parseEnvelope(input);
  } catch {
    return unsafeEnvelopeFailure();
  }
}
