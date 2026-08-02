import { BrowserErrorSourceEventType, type BrowserErrorSourceEvent } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { EventType, type ErrorEventBodyParseResult } from '@aurora/event-schema';
import {
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  type ErrorCaptureDiagnosticStore,
} from './diagnostics.js';
import { convertJavaScriptError } from './javascript-error-converter.js';
import { convertPromiseRejection } from './promise-rejection-converter.js';
import {
  convertResourceError,
  type ResourceErrorConversionResult,
} from './resource-error-converter.js';

export interface ErrorSourceHandler {
  handle(event: BrowserErrorSourceEvent): void;
}

type ConversionResult = ErrorEventBodyParseResult | ResourceErrorConversionResult;

function convertSource(event: BrowserErrorSourceEvent): ConversionResult {
  if (event.type === BrowserErrorSourceEventType.JavaScript) {
    return convertJavaScriptError(event);
  }
  if (event.type === BrowserErrorSourceEventType.UnhandledRejection) {
    return convertPromiseRejection(event);
  }
  return convertResourceError(event);
}

export function createErrorSourceHandler(
  submitEvent: CorePluginContext['submitEvent'],
  diagnostics: ErrorCaptureDiagnosticStore,
): ErrorSourceHandler {
  let isHandlingSource = false;

  function handle(event: BrowserErrorSourceEvent): void {
    if (isHandlingSource) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.RecursiveCaptureBlocked,
        operation: ErrorCaptureDiagnosticOperation.Notify,
        sourceType: event.type,
      });
      return;
    }
    isHandlingSource = true;
    try {
      const converted = convertSource(event);
      if (!converted.success) {
        diagnostics.append({
          code:
            'unsupportedSource' in converted
              ? ErrorCaptureDiagnosticCode.UnsupportedSource
              : ErrorCaptureDiagnosticCode.ErrorBodyRejected,
          operation: ErrorCaptureDiagnosticOperation.Convert,
          sourceType: event.type,
        });
        return;
      }
      const result = submitEvent({
        eventType: EventType.Error,
        body: converted.data,
      });
      if (!result.ok) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.EventSubmissionFailed,
          operation: ErrorCaptureDiagnosticOperation.Submit,
          sourceType: event.type,
        });
      }
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InternalError,
        operation: ErrorCaptureDiagnosticOperation.Notify,
        sourceType: event.type,
      });
    } finally {
      isHandlingSource = false;
    }
  }

  return Object.freeze({ handle });
}
