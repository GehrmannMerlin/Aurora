import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  type PerformanceEventEnvelope,
} from '../performance-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: PerformanceEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function envelope(eventId: string, body: unknown, occurredAt: number): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Performance,
    occurredAt,
    body,
  };
}

export const boundaryPerformanceEventSamples: readonly BoundaryPerformanceEventSample[] = [
  {
    name: 'zero millisecond value',
    input: envelope(
      'evt-perf-boundary-zero',
      {
        metricCategory: PerformanceMetricCategory.Page,
        metricName: PerformanceMetricName.Lcp,
        value: 0,
        unit: PerformanceMetricUnit.Millisecond,
        startedAt: 1_800_000_005_000,
      },
      1_800_000_005_500,
    ),
    isValid: true,
  },
  {
    name: 'ratio at one',
    input: envelope(
      'evt-perf-boundary-ratio-one',
      {
        metricCategory: PerformanceMetricCategory.Page,
        metricName: PerformanceMetricName.Cls,
        value: 1,
        unit: PerformanceMetricUnit.Ratio,
        startedAt: 1_800_000_005_001,
      },
      1_800_000_005_501,
    ),
    isValid: true,
  },
  {
    name: 'millisecond at max safe integer',
    input: envelope(
      'evt-perf-boundary-max',
      {
        metricCategory: PerformanceMetricCategory.Page,
        metricName: PerformanceMetricName.Lcp,
        value: PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger,
        unit: PerformanceMetricUnit.Millisecond,
        startedAt: 1_800_000_005_002,
      },
      1_800_000_005_502,
    ),
    isValid: true,
  },
  {
    name: 'ratio over one',
    input: envelope(
      'evt-perf-boundary-ratio-over',
      {
        metricCategory: PerformanceMetricCategory.Page,
        metricName: PerformanceMetricName.Cls,
        value: 1.0001,
        unit: PerformanceMetricUnit.Ratio,
        startedAt: 1_800_000_005_003,
      },
      1_800_000_005_503,
    ),
    isValid: false,
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'millisecond over max',
    input: envelope(
      'evt-perf-boundary-over',
      {
        metricCategory: PerformanceMetricCategory.Page,
        metricName: PerformanceMetricName.Lcp,
        value: PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger + 1,
        unit: PerformanceMetricUnit.Millisecond,
        startedAt: 1_800_000_005_004,
      },
      1_800_000_005_504,
    ),
    isValid: false,
    expectedIssueCode: 'invalid_number',
  },
];
