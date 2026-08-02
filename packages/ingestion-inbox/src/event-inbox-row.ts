import type { EventEnvelope } from '@aurora/event-schema';

/** Internal event_inbox row shape (subset needed for persistence mapping). */
export interface InboxEventRow {
  readonly eventId: string;
  readonly eventType: string;
  readonly protocolVersion: number;
  readonly envelope: unknown;
  readonly batchIndex: number;
  readonly receivedAt: string;
}

/**
 * Serialize a schema-validated EventEnvelope to a JSON string for the JSONB
 * column. Never rewrites the eventId or any envelope field.
 */
export function eventEnvelopeToJson(event: EventEnvelope): string {
  return JSON.stringify(event);
}

/** Parse a stored JSONB value back to an object; throws on invalid JSON. */
export function jsonToEventEnvelope(json: unknown): unknown {
  if (typeof json === 'string') {
    return JSON.parse(json) as unknown;
  }
  if (typeof json === 'object' && json !== null) {
    return json;
  }
  throw new TypeError('stored envelope must be a JSON string or object');
}
