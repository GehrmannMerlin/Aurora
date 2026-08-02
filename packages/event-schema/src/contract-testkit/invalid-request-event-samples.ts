import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

function envelope(body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-request-invalid-synthetic',
    eventType: EventType.Request,
    occurredAt: 1_800_000_005_600,
    body,
  };
}

export const invalidRequestEventSamples: readonly InvalidRequestEventSample[] = [
  {
    name: 'missing method',
    input: envelope({
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'lowercase method',
    input: envelope({
      method: 'get',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'empty URL',
    input: envelope({
      method: 'GET',
      url: '',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'string_empty',
  },
  {
    name: 'data scheme URL',
    input: envelope({
      method: 'GET',
      url: 'data:text/plain,synthetic',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_url',
  },
  {
    name: 'relative URL',
    input: envelope({
      method: 'GET',
      url: '/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_url',
  },
  {
    name: 'missing outcome',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
    }),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'unknown outcome',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'failed',
    }),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'negative duration',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: -1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'status code above range',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
      statusCode: 600,
    }),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'zero startedAt',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 0,
      durationMs: 1,
      outcome: 'success',
    }),
    expectedIssueCode: 'invalid_timestamp',
  },
  {
    name: 'unknown body field',
    input: envelope({
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1,
      durationMs: 1,
      outcome: 'success',
      page: 'x',
    }),
    expectedIssueCode: 'unknown_field',
  },
  {
    name: 'request body uses error event type',
    input: {
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      eventId: 'evt-request-invalid-mismatch',
      eventType: EventType.Error,
      occurredAt: 1_800_000_005_601,
      body: {
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      },
    },
    expectedIssueCode: 'event_type_mismatch',
  },
];
