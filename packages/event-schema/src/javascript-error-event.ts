import { ErrorCategory, type JavaScriptErrorEventBody } from './error-event-types.js';
import { readRequiredErrorField, rejectUnknownErrorFields } from './error-event-validation.js';
import { parseErrorDescriptor } from './error-descriptor.js';
import type { EventSchemaIssue } from './validation-issues.js';

const JAVASCRIPT_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'error']);

export function parseJavaScriptErrorEventBody(
  input: Record<string, unknown>,
  issues: EventSchemaIssue[],
): JavaScriptErrorEventBody | undefined {
  rejectUnknownErrorFields(input, JAVASCRIPT_BODY_FIELDS, issues, ['body']);
  const errorField = readRequiredErrorField(input, 'error', issues, ['body']);
  const error = errorField.found
    ? parseErrorDescriptor(errorField.value, issues, ['body', 'error'])
    : undefined;
  if (error === undefined) return undefined;
  return { category: ErrorCategory.JavaScript, error };
}
