import type { EventEnvelope } from './event-envelope.js';
import type { EventType } from './event-types.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const PerformanceMetricCategory = Object.freeze({
  Page: 'page',
} as const);

export type PerformanceMetricCategory =
  (typeof PerformanceMetricCategory)[keyof typeof PerformanceMetricCategory];

export const PerformanceMetricName = Object.freeze({
  Lcp: 'lcp',
  Inp: 'inp',
  Cls: 'cls',
  PageLoad: 'page_load',
} as const);

export type PerformanceMetricName =
  (typeof PerformanceMetricName)[keyof typeof PerformanceMetricName];

export const PerformanceMetricUnit = Object.freeze({
  Millisecond: 'millisecond',
  Ratio: 'ratio',
} as const);

export type PerformanceMetricUnit =
  (typeof PerformanceMetricUnit)[keyof typeof PerformanceMetricUnit];

export const PERFORMANCE_EVENT_LIMITS = Object.freeze({
  maxMetricNameLength: 64,
  maxValueSafeInteger: 2147483647,
  maxRatioValue: 1,
  maxDurationMs: 86400000,
} as const);

export interface PerformanceEventBody {
  readonly metricCategory: PerformanceMetricCategory;
  readonly metricName: PerformanceMetricName;
  readonly value: number;
  readonly unit: PerformanceMetricUnit;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export interface PerformanceEventEnvelope extends EventEnvelope {
  readonly eventType: typeof EventType.Performance;
  readonly body: PerformanceEventBody;
}

export interface PerformanceEventBodyParseSuccess {
  readonly success: true;
  readonly data: PerformanceEventBody;
}

export type PerformanceEventBodyParseFailure = EventEnvelopeParseFailure;
export type PerformanceEventBodyParseResult =
  PerformanceEventBodyParseSuccess | PerformanceEventBodyParseFailure;

export interface PerformanceEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: PerformanceEventEnvelope;
}

export type PerformanceEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type PerformanceEventEnvelopeParseResult =
  PerformanceEventEnvelopeParseSuccess | PerformanceEventEnvelopeParseFailure;
