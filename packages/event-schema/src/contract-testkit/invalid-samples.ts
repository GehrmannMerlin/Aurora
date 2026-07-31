import { CURRENT_PROTOCOL_VERSION, EVENT_SCHEMA_LIMITS } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidEventEnvelopeSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

const validBase = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-invalid-synthetic-base',
  eventType: EventType.Error,
  occurredAt: 1_800_000_000_100,
  body: {},
} as const;

function nestedBody(depth: number): unknown {
  let body: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) body = { nested: body };
  return body;
}

const cyclicBody: { self?: unknown } = {};
cyclicBody.self = cyclicBody;

export const invalidEventEnvelopeSamples: readonly InvalidEventEnvelopeSample[] = [
  {
    name: 'missing eventId',
    input: {
      protocolVersion: validBase.protocolVersion,
      eventType: validBase.eventType,
      occurredAt: validBase.occurredAt,
      body: validBase.body,
    },
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'protocol version has wrong type',
    input: { ...validBase, protocolVersion: '1' },
    expectedIssueCode: 'invalid_type',
  },
  {
    name: 'unsupported protocol version',
    input: { ...validBase, protocolVersion: 2 },
    expectedIssueCode: 'unsupported_protocol_version',
  },
  {
    name: 'event enum has wrong case',
    input: { ...validBase, eventType: 'Error' },
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'unknown event type',
    input: { ...validBase, eventType: 'session-replay' },
    expectedIssueCode: 'unknown_event_type',
  },
  {
    name: 'event ID is too long',
    input: { ...validBase, eventId: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength + 1) },
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'event body string is too long',
    input: { ...validBase, body: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength + 1) },
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'event body array is too large',
    input: {
      ...validBase,
      body: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null),
    },
    expectedIssueCode: 'array_too_large',
  },
  {
    name: 'event body object has too many keys',
    input: {
      ...validBase,
      body: Object.fromEntries(
        Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
          `field${String(index)}`,
          null,
        ]),
      ),
    },
    expectedIssueCode: 'object_too_large',
  },
  {
    name: 'event body object is too deep',
    input: { ...validBase, body: nestedBody(EVENT_SCHEMA_LIMITS.maxObjectDepth + 1) },
    expectedIssueCode: 'object_too_deep',
  },
  {
    name: 'event timestamp is invalid',
    input: { ...validBase, occurredAt: 0 },
    expectedIssueCode: 'invalid_timestamp',
  },
  {
    name: 'event body number is not finite',
    input: { ...validBase, body: Number.NaN },
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'event body is cyclic',
    input: { ...validBase, body: cyclicBody },
    expectedIssueCode: 'cyclic_reference',
  },
  {
    name: 'event body contains forbidden field',
    input: { ...validBase, body: { nested: { authorization: 'synthetic' } } },
    expectedIssueCode: 'forbidden_field',
  },
  {
    name: 'event envelope has an unknown field',
    input: { ...validBase, extra: true },
    expectedIssueCode: 'unknown_field',
  },
];
