import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { computeErrorFingerprint } from './error-fingerprint.js';
import { ERROR_FINGERPRINT_VERSION } from './error-fingerprint-types.js';
import type { ErrorOccurrenceDbParams } from './error-occurrence-types.js';

const TOP_LEVEL_FIELDS = ['projectId', 'eventEnvelope'] as const;

/** A fingerprint is a non-empty bounded stable string (DAT-12 spec §4). */
function isValidFingerprint(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}

function isValidFingerprintVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value === ERROR_FINGERPRINT_VERSION;
}

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

  // Fingerprint: use the processor-passed value when present (validate format),
  // otherwise compute internally as a legacy-caller fallback so the NOT NULL
  // column is always populated (DAT-12 §11).
  const passedFingerprint = input.fingerprint;
  let fingerprint: string;
  if (passedFingerprint !== undefined) {
    if (!isValidFingerprint(passedFingerprint)) {
      return invalid('invalid_fingerprint');
    }
    fingerprint = passedFingerprint;
  } else {
    fingerprint = computeErrorFingerprint({ projectId, body: envelope.body }).fingerprint;
  }

  const passedVersion = input.fingerprintVersion;
  let fingerprintVersion: number;
  if (passedVersion !== undefined) {
    if (!isValidFingerprintVersion(passedVersion)) {
      return invalid('invalid_fingerprint_version');
    }
    fingerprintVersion = passedVersion;
  } else {
    fingerprintVersion = ERROR_FINGERPRINT_VERSION;
  }

  return {
    projectId,
    eventId: envelope.eventId,
    protocolVersion: envelope.protocolVersion,
    occurredAtIso: new Date(envelope.occurredAt).toISOString(),
    errorCategory: envelope.body.category,
    normalizedBody: envelope.body,
    fingerprint,
    fingerprintVersion,
  };
}
