import {
  CURRENT_PROTOCOL_VERSION,
  ErrorCategory,
  EventType,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  RequestMethod,
  RequestOutcome,
  type EventEnvelope,
} from '@aurora/event-schema';

/** A deterministic mixed event: error / request / performance, one third each. */
export type BenchmarkEventKind = 'error' | 'request' | 'performance';

const ERROR_CATEGORIES: readonly BenchmarkEventKind[] = ['error', 'request', 'performance'];

/**
 * Deterministic legal event factory. The same runId and event index produce the
 * same event category sequence; no Math.random and no user input is used.
 * Bodies are fixed, sanitized, minimal legal values.
 */
export function benchmarkEventFor(
  runId: string,
  eventIndex: number,
  occurredAt: number,
): EventEnvelope {
  const kind = ERROR_CATEGORIES[eventIndex % ERROR_CATEGORIES.length] ?? 'error';
  const eventId = `${runId}-${String(eventIndex).padStart(8, '0')}`;
  switch (kind) {
    case 'error':
      return {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        eventId,
        eventType: EventType.Error,
        occurredAt,
        body: {
          category: ErrorCategory.JavaScript,
          error: { message: 'Synthetic benchmark runtime failure' },
        },
      };
    case 'request':
      return {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        eventId,
        eventType: EventType.Request,
        occurredAt,
        body: {
          method: RequestMethod.Get,
          url: 'https://benchmark.invalid/ping',
          startedAt: occurredAt,
          durationMs: 1,
          outcome: RequestOutcome.Success,
          statusCode: 200,
        },
      };
    case 'performance':
      return {
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        eventId,
        eventType: EventType.Performance,
        occurredAt,
        body: {
          metricCategory: PerformanceMetricCategory.Page,
          metricName: PerformanceMetricName.Lcp,
          value: 1,
          unit: PerformanceMetricUnit.Millisecond,
          startedAt: occurredAt,
        },
      };
  }
}
