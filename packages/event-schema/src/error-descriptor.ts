import { ERROR_EVENT_LIMITS, type ErrorDescriptor } from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  parseBoundedErrorString,
  readRequiredErrorField,
  rejectUnknownErrorFields,
} from './error-event-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';

const ERROR_DESCRIPTOR_FIELDS: ReadonlySet<string> = new Set(['name', 'message', 'stack']);

export function parseErrorDescriptor(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): ErrorDescriptor | undefined {
  if (!isPlainErrorRecord(input)) {
    addErrorEventIssue(issues, 'invalid_type', path, 'Error descriptor must be a plain object');
    return undefined;
  }
  rejectUnknownErrorFields(input, ERROR_DESCRIPTOR_FIELDS, issues, path);
  const messageField = readRequiredErrorField(input, 'message', issues, path);
  const message = messageField.found
    ? parseBoundedErrorString(
        messageField.value,
        ERROR_EVENT_LIMITS.maxErrorMessageLength,
        issues,
        [...path, 'message'],
      )
    : undefined;
  const name = Object.prototype.hasOwnProperty.call(input, 'name')
    ? parseBoundedErrorString(input.name, ERROR_EVENT_LIMITS.maxErrorNameLength, issues, [
        ...path,
        'name',
      ])
    : undefined;
  const stack = Object.prototype.hasOwnProperty.call(input, 'stack')
    ? parseBoundedErrorString(input.stack, ERROR_EVENT_LIMITS.maxStackLength, issues, [
        ...path,
        'stack',
      ])
    : undefined;
  if (message === undefined) return undefined;
  return {
    ...(name === undefined ? {} : { name }),
    message,
    ...(stack === undefined ? {} : { stack }),
  };
}
