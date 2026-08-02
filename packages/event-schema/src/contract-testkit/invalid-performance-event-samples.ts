import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metricCategory: 'page',
    metricName: 'lcp',
    value: 2500,
    unit: 'millisecond',
    startedAt: 1_800_000_005_000,
    ...overrides,
  };
}

function drop(...keys: readonly string[]): Record<string, unknown> {
  const base = body();
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (!keys.includes(key)) result[key] = value;
  }
  return result;
}

function envelope(candidate: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-perf-invalid-synthetic',
    eventType: EventType.Performance,
    occurredAt: 1_800_000_005_600,
    body: candidate,
  };
}

export const invalidPerformanceEventSamples: readonly InvalidPerformanceEventSample[] = [
  {
    name: 'missing category',
    input: envelope(drop('metricCategory')),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'missing name',
    input: envelope(drop('metricName')),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'missing value',
    input: envelope(drop('value')),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'missing unit',
    input: envelope(drop('unit')),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'missing startedAt',
    input: envelope(drop('startedAt')),
    expectedIssueCode: 'missing_required_field',
  },
  {
    name: 'unknown category',
    input: envelope(body({ metricCategory: 'resource' })),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'unapproved metric',
    input: envelope(body({ metricName: 'fcp' })),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'unknown unit',
    input: envelope(body({ unit: 'second' })),
    expectedIssueCode: 'invalid_enum',
  },
  {
    name: 'negative millisecond',
    input: envelope(body({ value: -1 })),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'non-integer millisecond',
    input: envelope(body({ value: 2500.5 })),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'NaN value',
    input: envelope(body({ value: Number.NaN })),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'ratio over one',
    input: envelope(body({ metricName: 'cls', value: 1.5, unit: 'ratio' })),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'startedAt zero',
    input: envelope(body({ startedAt: 0 })),
    expectedIssueCode: 'invalid_timestamp',
  },
  {
    name: 'duration over limit',
    input: envelope(body({ durationMs: 86400001 })),
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'unknown field',
    input: envelope(body({ page: 'x' })),
    expectedIssueCode: 'unknown_field',
  },
];
