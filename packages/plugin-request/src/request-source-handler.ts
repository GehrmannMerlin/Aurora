import { BrowserRequestSourceEventType, type BrowserRequestSourceEvent } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { EventType } from '@aurora/event-schema';
import {
  RequestCaptureDiagnosticCode,
  RequestCaptureDiagnosticOperation,
  type RequestCaptureDiagnosticStore,
} from './diagnostics.js';
import {
  createRequestEventConverter,
  isFetchMechanism,
  type RequestBodyConversionResult,
} from './request-event-converter.js';

export interface RequestSourceHandler {
  handle(event: BrowserRequestSourceEvent): void;
}

function mechanismOf(event: BrowserRequestSourceEvent): BrowserRequestSourceEventType {
  return isFetchMechanism(event)
    ? BrowserRequestSourceEventType.Fetch
    : BrowserRequestSourceEventType.Xhr;
}

export function createRequestSourceHandler(
  submitEvent: CorePluginContext['submitEvent'],
  diagnostics: RequestCaptureDiagnosticStore,
): RequestSourceHandler {
  const converter = createRequestEventConverter();
  let isHandlingSource = false;

  function handle(event: BrowserRequestSourceEvent): void {
    if (isHandlingSource) {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.RecursiveCaptureBlocked,
        operation: RequestCaptureDiagnosticOperation.Notify,
        mechanism: mechanismOf(event),
      });
      return;
    }
    isHandlingSource = true;
    try {
      const converted: RequestBodyConversionResult = converter.convert(event);
      if (!converted.success) {
        const code = 'code' in converted ? converted.code : null;
        diagnostics.append({
          code:
            code === 'unsupported_method'
              ? RequestCaptureDiagnosticCode.UnsupportedMethod
              : code === 'invalid_browser_fact'
                ? RequestCaptureDiagnosticCode.InvalidBrowserFact
                : RequestCaptureDiagnosticCode.RequestBodyRejected,
          operation: RequestCaptureDiagnosticOperation.Convert,
          mechanism: mechanismOf(event),
        });
        return;
      }
      const result = submitEvent({
        eventType: EventType.Request,
        body: converted.data,
      });
      if (!result.ok) {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.EventSubmissionFailed,
          operation: RequestCaptureDiagnosticOperation.Submit,
          mechanism: mechanismOf(event),
        });
      }
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InternalError,
        operation: RequestCaptureDiagnosticOperation.Notify,
        mechanism: mechanismOf(event),
      });
    } finally {
      isHandlingSource = false;
    }
  }

  return Object.freeze({ handle });
}
