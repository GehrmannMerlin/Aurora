import { CURRENT_PROTOCOL_VERSION } from './constants.js';
import { parseEventEnvelope, type EventEnvelope } from './event-envelope.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import { BATCH_EVENT_LIMITS, type IngestionBatchRequestParseResult } from './ingestion-types.js';
import type { EventSchemaIssue } from './validation-issues.js';

const BATCH_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'protocolVersion',
  'events',
  'receivedAt',
]);

function parseTimestamp(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) {
    addValidationIssue(
      issues,
      'invalid_timestamp',
      ['receivedAt'],
      'receivedAt must be a positive safe integer',
    );
    return undefined;
  }
  return input;
}

export function parseIngestionBatchRequest(input: unknown): IngestionBatchRequestParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        {
          code: 'invalid_type',
          path: [],
          message: 'Ingestion batch request must be a plain object',
        },
      ],
    };
  }
  const issues: EventSchemaIssue[] = [];
  rejectUnknownFields(input, BATCH_REQUEST_FIELDS, issues, []);
  const versionField = readRequiredField(input, 'protocolVersion', issues, []);
  const eventsField = readRequiredField(input, 'events', issues, []);
  const hasReceivedAt = Object.prototype.hasOwnProperty.call(input, 'receivedAt');

  let protocolVersion: 1 | undefined;
  if (versionField.found) {
    if (versionField.value !== CURRENT_PROTOCOL_VERSION) {
      addValidationIssue(
        issues,
        'unsupported_protocol_version',
        ['protocolVersion'],
        'Unsupported protocol version',
      );
    } else {
      protocolVersion = CURRENT_PROTOCOL_VERSION;
    }
  }

  let events: readonly EventEnvelope[] | undefined;
  if (eventsField.found) {
    if (!Array.isArray(eventsField.value)) {
      addValidationIssue(issues, 'invalid_type', ['events'], 'events must be an array');
    } else if (eventsField.value.length === 0) {
      addValidationIssue(
        issues,
        'missing_required_field',
        ['events'],
        'events must contain at least one event',
      );
    } else if (eventsField.value.length > BATCH_EVENT_LIMITS.maxEventsPerBatch) {
      addValidationIssue(
        issues,
        'array_too_large',
        ['events'],
        'events exceeds the maximum batch size',
      );
    } else {
      const parsedEvents: EventEnvelope[] = [];
      for (const [, element] of eventsField.value.entries()) {
        const envelopeResult = parseEventEnvelope(element);
        if (!envelopeResult.success) {
          issues.push(...envelopeResult.issues);
        } else {
          parsedEvents.push({
            protocolVersion: envelopeResult.data.protocolVersion,
            eventId: envelopeResult.data.eventId,
            eventType: envelopeResult.data.eventType,
            occurredAt: envelopeResult.data.occurredAt,
            body: envelopeResult.data.body,
          });
        }
      }
      if (issues.length === 0) {
        events = parsedEvents;
      }
    }
  }

  let receivedAt: number | undefined;
  if (hasReceivedAt) {
    const parsed = parseTimestamp(input.receivedAt, issues);
    if (parsed !== undefined) receivedAt = parsed;
  }

  if (protocolVersion === undefined || events === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: { protocolVersion, events, ...(receivedAt === undefined ? {} : { receivedAt }) },
  };
}
