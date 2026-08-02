import { appendIssue, type EventSchemaIssue } from './validation-issues.js';

export interface FieldReadSuccess {
  readonly found: true;
  readonly value: unknown;
}

export interface FieldReadFailure {
  readonly found: false;
}

export type FieldReadResult = FieldReadSuccess | FieldReadFailure;

export function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function addValidationIssue(
  issues: EventSchemaIssue[],
  code: EventSchemaIssue['code'],
  path: readonly (string | number)[],
  message: string,
): void {
  appendIssue(issues, { code, path: [...path], message });
}

export function readRequiredField(
  input: Record<string, unknown>,
  field: string,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): FieldReadResult {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    addValidationIssue(
      issues,
      'missing_required_field',
      [...path, field],
      'Required field is missing',
    );
    return { found: false };
  }
  return { found: true, value: input[field] };
}

export function rejectUnknownFields(
  input: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): void {
  if (Object.getOwnPropertySymbols(input).length > 0) {
    addValidationIssue(
      issues,
      'unknown_field',
      [...path, '$symbol'],
      'Symbol fields are not allowed',
    );
  }
  for (const field of Object.keys(input).sort()) {
    if (!allowedFields.has(field)) {
      addValidationIssue(issues, 'unknown_field', [...path, field], 'Unknown event body field');
    }
  }
}

export function parseBoundedString(
  input: unknown,
  maximumLength: number,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): string | undefined {
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Event body field must be a string');
    return undefined;
  }
  if (input.length === 0) {
    addValidationIssue(issues, 'string_empty', path, 'Event body string must not be empty');
    return undefined;
  }
  if (input.length > maximumLength) {
    addValidationIssue(issues, 'string_too_long', path, 'Event body string exceeds maximum length');
    return undefined;
  }
  return input;
}
