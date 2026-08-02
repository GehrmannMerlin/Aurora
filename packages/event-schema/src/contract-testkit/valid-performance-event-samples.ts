import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  type PerformanceEventBody,
  type PerformanceEventEnvelope,
} from '../performance-event-types.js';
import { EventType } from '../event-types.js';

export interface ValidPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: PerformanceEventEnvelope;
}

function envelope(
  eventId: string,
  body: PerformanceEventBody,
  occurredAt: number,
): PerformanceEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Performance,
    occurredAt,
    body,
  };
}

const lcpBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.Lcp,
  value: 2500,
  unit: PerformanceMetricUnit.Millisecond,
  startedAt: 1_800_000_005_000,
} as const;
const inpBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.Inp,
  value: 180,
  unit: PerformanceMetricUnit.Millisecond,
  startedAt: 1_800_000_005_001,
} as const;
const clsBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.Cls,
  value: 0.125,
  unit: PerformanceMetricUnit.Ratio,
  startedAt: 1_800_000_005_002,
} as const;
const pageLoadBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.PageLoad,
  value: 3200,
  unit: PerformanceMetricUnit.Millisecond,
  startedAt: 1_800_000_005_003,
  durationMs: 3400,
} as const;

export const validPerformanceEventSamples: readonly ValidPerformanceEventSample[] = [
  {
    name: 'LCP in milliseconds',
    input: envelope('evt-perf-valid-lcp', lcpBody, 1_800_000_005_500),
    expected: envelope('evt-perf-valid-lcp', lcpBody, 1_800_000_005_500),
  },
  {
    name: 'INP in milliseconds',
    input: envelope('evt-perf-valid-inp', inpBody, 1_800_000_005_501),
    expected: envelope('evt-perf-valid-inp', inpBody, 1_800_000_005_501),
  },
  {
    name: 'CLS as a ratio',
    input: envelope('evt-perf-valid-cls', clsBody, 1_800_000_005_502),
    expected: envelope('evt-perf-valid-cls', clsBody, 1_800_000_005_502),
  },
  {
    name: 'page load with duration',
    input: envelope('evt-perf-valid-load', pageLoadBody, 1_800_000_005_503),
    expected: envelope('evt-perf-valid-load', pageLoadBody, 1_800_000_005_503),
  },
];
