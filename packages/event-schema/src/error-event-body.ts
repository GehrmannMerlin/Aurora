import {
  ErrorCategory,
  type ErrorEventBody,
  type ErrorEventBodyParseResult,
} from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  readRequiredErrorField,
} from './error-event-validation.js';
import { parseJavaScriptErrorEventBody } from './javascript-error-event.js';
import { parsePromiseRejectionErrorEventBody } from './promise-rejection-error-event.js';
import { parseResourceLoadErrorEventBody } from './resource-error-event.js';
import type { EventSchemaIssue } from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

function unsafeBodyFailure(): ErrorEventBodyParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: ['body'],
        message: 'Error event body could not be read safely',
      },
    ],
  };
}

function parseBody(input: unknown): ErrorEventBodyParseResult {
  const issues: EventSchemaIssue[] = [];
  validateBodyValue(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (!isPlainErrorRecord(input)) {
    addErrorEventIssue(issues, 'invalid_type', ['body'], 'Error event body must be a plain object');
    return { success: false, issues };
  }
  const categoryField = readRequiredErrorField(input, 'category', issues, ['body']);
  if (!categoryField.found) return { success: false, issues };
  if (typeof categoryField.value !== 'string') {
    addErrorEventIssue(
      issues,
      'invalid_type',
      ['body', 'category'],
      'Error category must be a string',
    );
    return { success: false, issues };
  }
  let data: ErrorEventBody | undefined;
  if (categoryField.value === ErrorCategory.JavaScript) {
    data = parseJavaScriptErrorEventBody(input, issues);
  } else if (categoryField.value === ErrorCategory.UnhandledRejection) {
    data = parsePromiseRejectionErrorEventBody(input, issues);
  } else if (categoryField.value === ErrorCategory.Resource) {
    data = parseResourceLoadErrorEventBody(input, issues);
  } else {
    addErrorEventIssue(
      issues,
      'invalid_enum',
      ['body', 'category'],
      'Error category is not supported',
    );
  }
  return issues.length > 0 || data === undefined
    ? { success: false, issues }
    : { success: true, data };
}

export function parseErrorEventBody(input: unknown): ErrorEventBodyParseResult {
  try {
    return parseBody(input);
  } catch {
    return unsafeBodyFailure();
  }
}
