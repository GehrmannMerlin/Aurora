import type { BrowserJavaScriptErrorSourceEvent } from '@aurora/browser';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  parseErrorEventBody,
  type ErrorEventBodyParseResult,
} from '@aurora/event-schema';
import { createErrorDescriptor, sanitizeErrorText } from './error-descriptor.js';

const fallbackMessage = 'Unknown JavaScript error';

export function convertJavaScriptError(
  event: BrowserJavaScriptErrorSourceEvent,
): ErrorEventBodyParseResult {
  const message =
    sanitizeErrorText(event.message, ERROR_EVENT_LIMITS.maxErrorMessageLength) ?? fallbackMessage;
  return parseErrorEventBody({
    category: ErrorCategory.JavaScript,
    error:
      event.error instanceof Error
        ? createErrorDescriptor(event.error, message)
        : createErrorDescriptor(undefined, message),
  });
}
