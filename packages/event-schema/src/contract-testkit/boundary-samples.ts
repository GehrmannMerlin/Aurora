import { CURRENT_PROTOCOL_VERSION, EVENT_SCHEMA_LIMITS } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryEventEnvelopeSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function nestedBody(depth: number): unknown {
  let body: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) body = { nested: body };
  return body;
}

const base = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventType: EventType.Performance,
  occurredAt: 1_800_000_000_200,
} as const;

export const boundaryEventEnvelopeSamples: readonly BoundaryEventEnvelopeSample[] = [
  {
    name: 'maximum event ID and string length',
    input: {
      ...base,
      eventId: 'e'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength),
      body: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength),
    },
    isValid: true,
  },
  {
    name: 'maximum array length',
    input: {
      ...base,
      eventId: 'evt-boundary-array',
      body: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null),
    },
    isValid: true,
  },
  {
    name: 'maximum object key count',
    input: {
      ...base,
      eventId: 'evt-boundary-object-keys',
      body: Object.fromEntries(
        Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys }, (_, index) => [
          `field${String(index)}`,
          null,
        ]),
      ),
    },
    isValid: true,
  },
  {
    name: 'maximum object depth',
    input: {
      ...base,
      eventId: 'evt-boundary-depth',
      body: nestedBody(EVENT_SCHEMA_LIMITS.maxObjectDepth),
    },
    isValid: true,
  },
  {
    name: 'one over maximum object depth',
    input: {
      ...base,
      eventId: 'evt-boundary-depth-over',
      body: nestedBody(EVENT_SCHEMA_LIMITS.maxObjectDepth + 1),
    },
    isValid: false,
    expectedIssueCode: 'object_too_deep',
  },
  {
    name: 'same-version older shape without optional body data',
    input: { ...base, eventId: 'evt-compatible-old', body: {} },
    isValid: true,
  },
  {
    name: 'same-version newer shape with optional body data',
    input: {
      ...base,
      eventId: 'evt-compatible-new',
      body: { optionalContext: { attempt: 1 } },
    },
    isValid: true,
  },
  {
    name: 'older unsupported protocol version',
    input: { ...base, protocolVersion: 0, eventId: 'evt-version-old', body: {} },
    isValid: false,
    expectedIssueCode: 'unsupported_protocol_version',
  },
  {
    name: 'newer unsupported protocol version',
    input: { ...base, protocolVersion: 2, eventId: 'evt-version-new', body: {} },
    isValid: false,
    expectedIssueCode: 'unsupported_protocol_version',
  },
];
