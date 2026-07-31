import {
  EVENT_SCHEMA_LIMITS,
  isSupportedProtocolVersion,
  type ProtocolVersion,
} from './constants.js';
import { EventType, isEventType, type EventType as EventTypeValue } from './event-types.js';
import {
  appendIssue,
  type EventEnvelopeParseFailure,
  type EventSchemaIssue,
} from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

export interface EventEnvelope {
  readonly protocolVersion: ProtocolVersion;
  readonly eventId: string;
  readonly eventType: EventTypeValue;
  readonly occurredAt: number;
  readonly body: unknown;
}

export interface EventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: EventEnvelope;
}

export type EventEnvelopeParseResult = EventEnvelopeParseSuccess | EventEnvelopeParseFailure;

const REQUIRED_FIELDS = ['protocolVersion', 'eventId', 'eventType', 'occurredAt', 'body'] as const;
const ALLOWED_FIELDS: ReadonlySet<string> = new Set(REQUIRED_FIELDS);
const canonicalEventTypes: ReadonlySet<string> = new Set(Object.values(EventType));

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function addIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): void {
  appendIssue(issues, { code, path, message });
}

function validateProtocolVersion(
  input: unknown,
  issues: EventSchemaIssue[],
): ProtocolVersion | undefined {
  if (typeof input !== 'number') {
    addIssue(issues, 'invalid_type', ['protocolVersion'], 'protocolVersion must be a number');
    return undefined;
  }
  if (!isSupportedProtocolVersion(input)) {
    addIssue(
      issues,
      'unsupported_protocol_version',
      ['protocolVersion'],
      'protocolVersion is not supported',
    );
    return undefined;
  }
  return input;
}

function validateEventId(input: unknown, issues: EventSchemaIssue[]): string | undefined {
  if (typeof input !== 'string' || input.length === 0) {
    addIssue(issues, 'invalid_type', ['eventId'], 'eventId must be a non-empty string');
    return undefined;
  }
  if (input.length > EVENT_SCHEMA_LIMITS.maxEventIdLength) {
    addIssue(issues, 'string_too_long', ['eventId'], 'eventId exceeds maximum length');
    return undefined;
  }
  return input;
}

function validateEventType(input: unknown, issues: EventSchemaIssue[]): EventTypeValue | undefined {
  if (typeof input !== 'string') {
    addIssue(issues, 'invalid_type', ['eventType'], 'eventType must be a string');
    return undefined;
  }
  if (isEventType(input)) return input;
  if (canonicalEventTypes.has(input.toLowerCase())) {
    addIssue(issues, 'invalid_enum', ['eventType'], 'eventType values are case-sensitive');
    return undefined;
  }
  addIssue(issues, 'unknown_event_type', ['eventType'], 'eventType is not supported');
  return undefined;
}

function validateOccurredAt(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  if (typeof input !== 'number') {
    addIssue(issues, 'invalid_type', ['occurredAt'], 'occurredAt must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input <= 0) {
    addIssue(
      issues,
      'invalid_timestamp',
      ['occurredAt'],
      'occurredAt must be a positive safe integer in Unix epoch milliseconds',
    );
    return undefined;
  }
  return input;
}

export function parseEventEnvelope(input: unknown): EventEnvelopeParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        { code: 'invalid_type', path: [], message: 'Event envelope must be a plain object' },
      ],
    };
  }

  const issues: EventSchemaIssue[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in input)) {
      addIssue(issues, 'missing_required_field', [field], `Missing required field: ${field}`);
    }
  }
  for (const field of Object.keys(input).sort()) {
    if (!ALLOWED_FIELDS.has(field)) {
      addIssue(issues, 'unknown_field', [field], `Unknown event envelope field: ${field}`);
    }
  }

  const protocolVersion = validateProtocolVersion(input.protocolVersion, issues);
  const eventId = validateEventId(input.eventId, issues);
  const eventType = validateEventType(input.eventType, issues);
  const occurredAt = validateOccurredAt(input.occurredAt, issues);
  validateBodyValue(input.body, issues);

  if (
    issues.length > 0 ||
    protocolVersion === undefined ||
    eventId === undefined ||
    eventType === undefined ||
    occurredAt === undefined
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: { protocolVersion, eventId, eventType, occurredAt, body: input.body },
  };
}
