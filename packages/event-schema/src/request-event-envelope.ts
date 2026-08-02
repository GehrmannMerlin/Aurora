import { parseRequestEventBody } from './request-event-body.js';
import type { RequestEventEnvelopeParseResult } from './request-event-types.js';
import { parseEventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';

function unsafeEnvelopeFailure(): RequestEventEnvelopeParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: [],
        message: 'Request event envelope could not be read safely',
      },
    ],
  };
}

function parseEnvelope(input: unknown): RequestEventEnvelopeParseResult {
  const envelopeResult = parseEventEnvelope(input);
  if (!envelopeResult.success) return envelopeResult;
  if (envelopeResult.data.eventType !== EventType.Request) {
    return {
      success: false,
      issues: [
        {
          code: 'event_type_mismatch',
          path: ['eventType'],
          message: 'Request event body requires the request event type',
        },
      ],
    };
  }
  const bodyResult = parseRequestEventBody(envelopeResult.data.body);
  if (!bodyResult.success) return bodyResult;
  return {
    success: true,
    data: {
      protocolVersion: envelopeResult.data.protocolVersion,
      eventId: envelopeResult.data.eventId,
      eventType: EventType.Request,
      occurredAt: envelopeResult.data.occurredAt,
      body: bodyResult.data,
    },
  };
}

export function parseRequestEventEnvelope(input: unknown): RequestEventEnvelopeParseResult {
  try {
    return parseEnvelope(input);
  } catch {
    return unsafeEnvelopeFailure();
  }
}
