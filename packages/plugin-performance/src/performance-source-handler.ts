import type { BrowserPerformanceSourceEvent } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { EventType } from '@aurora/event-schema';
import {
  PerformanceCaptureDiagnosticCode,
  PerformanceCaptureDiagnosticOperation,
  type PerformanceCaptureDiagnosticStore,
} from './diagnostics.js';
import {
  createPerformanceEventConverter,
  type PerformanceBodyConversionResult,
} from './performance-event-converter.js';

export interface PerformanceSourceHandler {
  handle(event: BrowserPerformanceSourceEvent): void;
}

export function createPerformanceSourceHandler(
  submitEvent: CorePluginContext['submitEvent'],
  diagnostics: PerformanceCaptureDiagnosticStore,
): PerformanceSourceHandler {
  const converter = createPerformanceEventConverter();
  let isHandlingFact = false;

  function handle(event: BrowserPerformanceSourceEvent): void {
    if (isHandlingFact) {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.RecursiveCaptureBlocked,
        operation: PerformanceCaptureDiagnosticOperation.Notify,
        metricName: event.metricName,
      });
      return;
    }
    isHandlingFact = true;
    try {
      const converted: PerformanceBodyConversionResult = converter.convert(event);
      if (!converted.success) {
        const code = 'code' in converted ? converted.code : null;
        diagnostics.append({
          code:
            code === 'performance_fact_invalid'
              ? PerformanceCaptureDiagnosticCode.PerformanceFactInvalid
              : PerformanceCaptureDiagnosticCode.PerformanceSchemaRejected,
          operation: PerformanceCaptureDiagnosticOperation.Convert,
          metricName: event.metricName,
        });
        return;
      }
      const result = submitEvent({
        eventType: EventType.Performance,
        body: converted.data,
      });
      if (!result.ok) {
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.EventSubmissionFailed,
          operation: PerformanceCaptureDiagnosticOperation.Submit,
          metricName: event.metricName,
        });
      }
    } catch {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InternalError,
        operation: PerformanceCaptureDiagnosticOperation.Notify,
        metricName: event.metricName,
      });
    } finally {
      isHandlingFact = false;
    }
  }

  return Object.freeze({ handle });
}
