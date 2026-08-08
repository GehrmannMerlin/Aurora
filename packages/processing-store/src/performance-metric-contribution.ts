import {
  PerformanceMetricName,
  PerformanceMetricUnit,
  PERFORMANCE_EVENT_LIMITS,
} from '@aurora/event-schema';
import type { PerformanceMetricBucketParams } from './performance-metric-types.js';

const TOP_LEVEL_FIELDS = [
  'projectId',
  'eventId',
  'occurredAt',
  'metricName',
  'unit',
  'value',
  'startedAt',
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
 * bucket parameters. The store validates the shape but does NOT classify
 * performance goodness, percentile, or exceedance. Bucket time base is the
 * envelope occurredAt, floored to the UTC minute.
 */
export function parsePerformanceMetricContributionInput(
  input: unknown,
): PerformanceMetricBucketParams | { readonly status: 'invalid_input'; readonly code: string } {
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
  const startedAt = input.startedAt;
  if (!Number.isSafeInteger(startedAt) || (startedAt as number) <= 0) {
    return invalid('invalid_started_at');
  }
  const metricName = input.metricName;
  if (typeof metricName !== 'string') {
    return invalid('invalid_metric_name');
  }
  if (!Object.values(PerformanceMetricName).includes(metricName as PerformanceMetricName)) {
    return invalid('invalid_metric_name');
  }
  const unit = input.unit;
  if (typeof unit !== 'string') {
    return invalid('invalid_unit');
  }
  if (!Object.values(PerformanceMetricUnit).includes(unit as PerformanceMetricUnit)) {
    return invalid('invalid_unit');
  }
  const value = input.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return invalid('invalid_value');
  }
  if (unit === PerformanceMetricUnit.Millisecond) {
    if (!Number.isSafeInteger(value) || value > PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger) {
      return invalid('invalid_value');
    }
  } else {
    // ratio (CLS): 0..1 finite non-negative.
    if (value > PERFORMANCE_EVENT_LIMITS.maxRatioValue) {
      return invalid('invalid_value');
    }
  }
  let durationMs: number | undefined;
  if (input.durationMs !== undefined) {
    const raw = input.durationMs;
    if (
      typeof raw !== 'number' ||
      !Number.isSafeInteger(raw) ||
      raw < 0 ||
      raw > PERFORMANCE_EVENT_LIMITS.maxDurationMs
    ) {
      return invalid('invalid_duration_ms');
    }
    durationMs = raw;
  }

  return {
    projectId,
    eventId,
    bucketStartIso: computeBucketStart(occurredAt as number).toISOString(),
    metricName,
    unit,
    value,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}
