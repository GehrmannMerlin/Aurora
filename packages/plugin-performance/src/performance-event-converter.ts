import {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  type BrowserPerformanceSourceEvent,
} from '@aurora/browser';
import {
  PerformanceMetricCategory,
  parsePerformanceEventBody,
  type PerformanceEventBodyParseResult,
} from '@aurora/event-schema';

export type PerformanceBodyConversionResult =
  | PerformanceEventBodyParseResult
  | { readonly success: false; readonly code: 'performance_fact_invalid' };

export function createPerformanceEventConverter() {
  const metricNames: ReadonlySet<string> = new Set(Object.values(BrowserPerformanceMetricName));
  const metricUnits: ReadonlySet<string> = new Set(Object.values(BrowserPerformanceMetricUnit));

  function convert(event: BrowserPerformanceSourceEvent): PerformanceBodyConversionResult {
    if (
      !metricNames.has(event.metricName) ||
      !metricUnits.has(event.unit) ||
      !Number.isFinite(event.value) ||
      !Number.isFinite(event.startedAt) ||
      (event.durationMs !== undefined && !Number.isFinite(event.durationMs))
    ) {
      return { success: false, code: 'performance_fact_invalid' };
    }
    const candidate: unknown = {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: event.metricName,
      value: event.value,
      unit: event.unit,
      startedAt: event.startedAt,
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    };
    return parsePerformanceEventBody(candidate);
  }
  return Object.freeze({ convert });
}
