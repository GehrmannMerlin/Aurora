import { parseErrorEventEnvelope } from '@aurora/event-schema';
import type { ErrorOccurrenceDbParams } from './error-occurrence-types.js';

const TOP_LEVEL_FIELDS = ['projectId', 'eventEnvelope'] as const;

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function invalid(code: string): { readonly status: 'invalid_input'; readonly code: string } {
  return { status: 'invalid_input', code };
}

/**
 * Validate the caller-facing unknown input and derive stable, already
 * protocol-validated database parameters. Never re-interprets the error event
 * contract; @aurora/event-schema root entry is the single validation source.
 */
export function parsePersistErrorEventOccurrenceInput(
  input: unknown,
): ErrorOccurrenceDbParams | { readonly status: 'invalid_input'; readonly code: string } {
  if (!isPlainRecord(input)) {
    return invalid('invalid_top_level');
  }
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in input)) {
      return invalid('invalid_top_level');
    }
  }
  const projectId = input.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return invalid('invalid_project_id');
  }

  const parsed = parseErrorEventEnvelope(input.eventEnvelope);
  if (!parsed.success) {
    return invalid('invalid_envelope');
  }
  const envelope = parsed.data;

  return {
    projectId,
    eventId: envelope.eventId,
    protocolVersion: envelope.protocolVersion,
    occurredAtIso: new Date(envelope.occurredAt).toISOString(),
    errorCategory: envelope.body.category,
    normalizedBody: envelope.body,
  };
}
