import { parseErrorDescriptor } from './error-descriptor.js';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  PromiseRejectionReasonKind,
  type PromiseRejectionReason,
  type SafeErrorValue,
  type UnhandledPromiseRejectionErrorEventBody,
} from './error-event-types.js';
import {
  addErrorEventIssue,
  isPlainErrorRecord,
  parseBoundedErrorString,
  readRequiredErrorField,
  rejectUnknownErrorFields,
} from './error-event-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';

const PROMISE_BODY_FIELDS: ReadonlySet<string> = new Set(['category', 'reason']);
const ERROR_REASON_FIELDS: ReadonlySet<string> = new Set(['kind', 'error']);
const VALUE_REASON_FIELDS: ReadonlySet<string> = new Set(['kind', 'value']);
const FORBIDDEN_PROMISE_VALUE_FIELDS: ReadonlySet<string> = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
]);

function copySafeErrorValue(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): SafeErrorValue | undefined {
  if (
    input === null ||
    typeof input === 'boolean' ||
    typeof input === 'string' ||
    (typeof input === 'number' && Number.isFinite(input))
  ) {
    return input;
  }
  if (Array.isArray(input)) {
    const output: SafeErrorValue[] = [];
    for (const [index, item] of input.entries()) {
      const copied = copySafeErrorValue(item, issues, [...path, index]);
      if (copied === undefined) return undefined;
      output.push(copied);
    }
    return output;
  }
  if (!isPlainErrorRecord(input)) return undefined;
  if (Object.getOwnPropertySymbols(input).length > 0) return undefined;
  const output: Record<string, SafeErrorValue> = {};
  for (const key of Object.keys(input).sort()) {
    const normalizedKey = key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
    if (FORBIDDEN_PROMISE_VALUE_FIELDS.has(normalizedKey)) {
      addErrorEventIssue(
        issues,
        'forbidden_field',
        [...path, key],
        'Promise rejection contains a forbidden field',
      );
      return undefined;
    }
    const copied = copySafeErrorValue(input[key], issues, [...path, key]);
    if (copied === undefined) return undefined;
    output[key] = copied;
  }
  return output;
}

function parseReason(
  input: unknown,
  issues: EventSchemaIssue[],
): PromiseRejectionReason | undefined {
  const path = ['body', 'reason'] as const;
  if (!isPlainErrorRecord(input)) {
    addErrorEventIssue(issues, 'invalid_type', path, 'Promise rejection reason must be an object');
    return undefined;
  }
  const kindField = readRequiredErrorField(input, 'kind', issues, path);
  if (!kindField.found) return undefined;
  if (typeof kindField.value !== 'string') {
    addErrorEventIssue(issues, 'invalid_type', [...path, 'kind'], 'Reason kind must be a string');
    return undefined;
  }
  if (kindField.value === PromiseRejectionReasonKind.Error) {
    rejectUnknownErrorFields(input, ERROR_REASON_FIELDS, issues, path);
    const errorField = readRequiredErrorField(input, 'error', issues, path);
    const error = errorField.found
      ? parseErrorDescriptor(errorField.value, issues, [...path, 'error'])
      : undefined;
    return error === undefined ? undefined : { kind: PromiseRejectionReasonKind.Error, error };
  }
  if (kindField.value === PromiseRejectionReasonKind.String) {
    rejectUnknownErrorFields(input, VALUE_REASON_FIELDS, issues, path);
    const valueField = readRequiredErrorField(input, 'value', issues, path);
    const value = valueField.found
      ? parseBoundedErrorString(
          valueField.value,
          ERROR_EVENT_LIMITS.maxRejectionStringLength,
          issues,
          [...path, 'value'],
        )
      : undefined;
    return value === undefined ? undefined : { kind: PromiseRejectionReasonKind.String, value };
  }
  if (kindField.value === PromiseRejectionReasonKind.NonStandard) {
    rejectUnknownErrorFields(input, VALUE_REASON_FIELDS, issues, path);
    const valueField = readRequiredErrorField(input, 'value', issues, path);
    if (!valueField.found) return undefined;
    if (typeof valueField.value === 'string') {
      addErrorEventIssue(
        issues,
        'invalid_type',
        [...path, 'value'],
        'Direct string rejection must use the string reason kind',
      );
      return undefined;
    }
    const issueCount = issues.length;
    const value = copySafeErrorValue(valueField.value, issues, [...path, 'value']);
    if (value === undefined) {
      if (issues.length === issueCount) {
        addErrorEventIssue(
          issues,
          'invalid_type',
          [...path, 'value'],
          'Non-standard rejection must be a safe JSON value',
        );
      }
      return undefined;
    }
    return { kind: PromiseRejectionReasonKind.NonStandard, value };
  }
  addErrorEventIssue(issues, 'invalid_enum', [...path, 'kind'], 'Reason kind is not supported');
  return undefined;
}

export function parsePromiseRejectionErrorEventBody(
  input: Record<string, unknown>,
  issues: EventSchemaIssue[],
): UnhandledPromiseRejectionErrorEventBody | undefined {
  rejectUnknownErrorFields(input, PROMISE_BODY_FIELDS, issues, ['body']);
  const reasonField = readRequiredErrorField(input, 'reason', issues, ['body']);
  const reason = reasonField.found ? parseReason(reasonField.value, issues) : undefined;
  return reason === undefined ? undefined : { category: ErrorCategory.UnhandledRejection, reason };
}
