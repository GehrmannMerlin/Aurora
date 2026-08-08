import { parseRequestEventEnvelope } from '@aurora/event-schema';
import type { RequestSampleDbParams } from './request-sample-types.js';

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
 * protocol-validated database parameters. Never re-interprets the request event
 * contract; @aurora/event-schema root entry is the single validation source.
 * The projected sample_body is the parsed RequestEventBody safe six-field
 * allowlist (URL already stripped of query and fragment by the protocol).
 */
export function parsePersistRequestEventSampleInput(
  input: unknown,
): RequestSampleDbParams | { readonly status: 'invalid_input'; readonly code: string } {
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

  const parsed = parseRequestEventEnvelope(input.eventEnvelope);
  if (!parsed.success) {
    return invalid('invalid_envelope');
  }
  const envelope = parsed.data;

  return {
    projectId,
    eventId: envelope.eventId,
    protocolVersion: envelope.protocolVersion,
    occurredAtIso: new Date(envelope.occurredAt).toISOString(),
    sampleBody: envelope.body,
  };
}
