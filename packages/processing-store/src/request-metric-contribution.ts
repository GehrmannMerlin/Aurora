import { RequestMethod, RequestOutcome } from '@aurora/event-schema';
import type { RequestMetricBucketParams } from './request-metric-types.js';

const TOP_LEVEL_FIELDS = [
  'projectId',
  'eventId',
  'occurredAt',
  'method',
  'outcome',
  'durationMs',
  'isFailure',
  'isSlow',
] as const;

const MINUTES_MS = 60_000;

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function invalid(code: string): { readonly status: 'invalid_input'; readonly code: string } {
  return { status: 'invalid_input', code };
}

/** Floor a Unix epoch millisecond timestamp to the start of its UTC minute. */
export function computeBucketStart(occurredAt: number): Date {
  return new Date(Math.floor(occurredAt / MINUTES_MS) * MINUTES_MS);
}

/**
 * Validate the caller-facing unknown input and derive stable, protocol-validated
 * bucket parameters. The store validates the shape of the contribution but does
 * NOT classify failure/slow; isFailure and isSlow are produced by the future
 * Request Processor. Bucket time base is the envelope occurredAt.
 */
export function parseRequestMetricContributionInput(
  input: unknown,
): RequestMetricBucketParams | { readonly status: 'invalid_input'; readonly code: string } {
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
  const eventId = input.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return invalid('invalid_event_id');
  }
  const occurredAt = input.occurredAt;
  if (!Number.isSafeInteger(occurredAt) || (occurredAt as number) <= 0) {
    return invalid('invalid_occurred_at');
  }
  const durationMs = input.durationMs;
  if (!Number.isSafeInteger(durationMs) || (durationMs as number) < 0) {
    return invalid('invalid_duration_ms');
  }
  const method = input.method;
  if (typeof method !== 'string') {
    return invalid('invalid_method');
  }
  if (!Object.values(RequestMethod).includes(method as RequestMethod)) {
    return invalid('invalid_method');
  }
  const outcome = input.outcome;
  if (typeof outcome !== 'string') {
    return invalid('invalid_outcome');
  }
  if (!Object.values(RequestOutcome).includes(outcome as RequestOutcome)) {
    return invalid('invalid_outcome');
  }
  let statusCode = 0;
  if (input.statusCode !== undefined) {
    const raw = input.statusCode;
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 100 || raw > 599) {
      return invalid('invalid_status_code');
    }
    statusCode = raw;
  }
  if (typeof input.isFailure !== 'boolean' || typeof input.isSlow !== 'boolean') {
    return invalid('invalid_boolean');
  }

  return {
    projectId,
    eventId,
    bucketStartIso: computeBucketStart(occurredAt as number).toISOString(),
    method,
    outcome,
    statusCode,
    durationMs: durationMs as number,
    isFailure: input.isFailure,
    isSlow: input.isSlow,
  };
}
