import { parsePerformanceEventEnvelope } from '@aurora/event-schema';
import type { PerformanceSampleDbParams } from './performance-sample-types.js';

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
 * protocol-validated database parameters. The projected sample_body is the
 * parsed PerformanceEventBody safe-field whitelist (metricName/value/unit/
 * startedAt/optional durationMs). metricCategory is constant `page` in v1 and
 * deliberately omitted; the envelope is never persisted whole.
 */
export function parsePersistPerformanceEventSampleInput(
  input: unknown,
): PerformanceSampleDbParams | { readonly status: 'invalid_input'; readonly code: string } {
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

  const parsed = parsePerformanceEventEnvelope(input.eventEnvelope);
  if (!parsed.success) {
    return invalid('invalid_envelope');
  }
  const envelope = parsed.data;
  const body = envelope.body;
  const sampleBody: Record<string, unknown> = {
    metricName: body.metricName,
    value: body.value,
    unit: body.unit,
    startedAt: body.startedAt,
  };
  if (body.durationMs !== undefined) {
    sampleBody.durationMs = body.durationMs;
  }

  return {
    projectId,
    eventId: envelope.eventId,
    occurredAtIso: new Date(envelope.occurredAt).toISOString(),
    sampleBody,
  };
}
