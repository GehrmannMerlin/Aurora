import type { BrowserUnhandledRejectionSourceEvent } from '@aurora/browser';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  PromiseRejectionReasonKind,
  parseErrorEventBody,
  type ErrorEventBodyParseResult,
} from '@aurora/event-schema';
import { createErrorDescriptor, sanitizeErrorText } from './error-descriptor.js';

const fallbackMessage = 'Unhandled promise rejection';

export function convertPromiseRejection(
  event: BrowserUnhandledRejectionSourceEvent,
): ErrorEventBodyParseResult {
  const reason = event.reason;
  if (reason instanceof Error) {
    return parseErrorEventBody({
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.Error,
        error: createErrorDescriptor(reason, fallbackMessage),
      },
    });
  }
  if (typeof reason === 'string') {
    return parseErrorEventBody({
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.String,
        value:
          sanitizeErrorText(reason, ERROR_EVENT_LIMITS.maxRejectionStringLength) ?? fallbackMessage,
      },
    });
  }
  return parseErrorEventBody({
    category: ErrorCategory.UnhandledRejection,
    reason: {
      kind: PromiseRejectionReasonKind.NonStandard,
      value: reason,
    },
  });
}
