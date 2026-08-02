import {
  addValidationIssue,
  isPlainRecord,
  parseBoundedString,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import {
  BATCH_EVENT_LIMITS,
  IngestionErrorCode,
  IngestionReceiptState,
  type IngestionEventReceipt,
  type IngestionEventReceiptParseResult,
  type IngestionRequestReceiptParseResult,
} from './ingestion-types.js';
import type { EventSchemaIssue } from './validation-issues.js';

const EVENT_RECEIPT_FIELDS: ReadonlySet<string> = new Set([
  'eventId',
  'state',
  'errorCode',
  'retryable',
  'retryAfterMs',
]);
const REQUEST_RECEIPT_FIELDS: ReadonlySet<string> = new Set([
  'batchState',
  'errorCode',
  'retryable',
  'retryAfterMs',
  'perEventResults',
]);

const states: ReadonlySet<unknown> = new Set(Object.values(IngestionReceiptState));
const errorCodes: ReadonlySet<unknown> = new Set(Object.values(IngestionErrorCode));

function parseState(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): IngestionReceiptState | undefined {
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'State must be a string');
    return undefined;
  }
  if (!states.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'State is not supported');
    return undefined;
  }
  return input as IngestionReceiptState;
}

function parseErrorCode(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): IngestionErrorCode | undefined {
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Error code must be a string');
    return undefined;
  }
  if (!errorCodes.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Error code is not supported');
    return undefined;
  }
  return input as IngestionErrorCode;
}

function parseRetryable(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): boolean | undefined {
  if (typeof input !== 'boolean') {
    addValidationIssue(issues, 'invalid_type', path, 'retryable must be a boolean');
    return undefined;
  }
  return input;
}

function parseRetryAfterMs(
  input: unknown,
  issues: EventSchemaIssue[],
  path: readonly (string | number)[],
): number | undefined {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'retryAfterMs must be a non-negative safe integer',
    );
    return undefined;
  }
  if (input > BATCH_EVENT_LIMITS.maxRetryAfterMs) {
    addValidationIssue(issues, 'invalid_number', path, 'retryAfterMs exceeds the maximum');
    return undefined;
  }
  return input;
}

export function parseIngestionEventReceipt(input: unknown): IngestionEventReceiptParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [{ code: 'invalid_type', path: [], message: 'Event receipt must be a plain object' }],
    };
  }
  const issues: EventSchemaIssue[] = [];
  rejectUnknownFields(input, EVENT_RECEIPT_FIELDS, issues, []);
  const eventIdField = readRequiredField(input, 'eventId', issues, []);
  const stateField = readRequiredField(input, 'state', issues, []);
  const hasErrorCode = Object.prototype.hasOwnProperty.call(input, 'errorCode');
  const retryableField = readRequiredField(input, 'retryable', issues, []);
  const hasRetryAfterMs = Object.prototype.hasOwnProperty.call(input, 'retryAfterMs');

  const eventId = eventIdField.found
    ? parseBoundedString(eventIdField.value, BATCH_EVENT_LIMITS.maxEventIdLength, issues, [
        'eventId',
      ])
    : undefined;
  const state = stateField.found ? parseState(stateField.value, issues, ['state']) : undefined;
  const errorCode = hasErrorCode
    ? parseErrorCode(input.errorCode, issues, ['errorCode'])
    : undefined;
  const retryable = retryableField.found
    ? parseRetryable(retryableField.value, issues, ['retryable'])
    : undefined;
  const retryAfterMs = hasRetryAfterMs
    ? parseRetryAfterMs(input.retryAfterMs, issues, ['retryAfterMs'])
    : undefined;

  if (eventId === undefined || state === undefined || retryable === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      eventId,
      state,
      ...(errorCode === undefined ? {} : { errorCode }),
      retryable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  };
}

export function parseIngestionRequestReceipt(input: unknown): IngestionRequestReceiptParseResult {
  if (!isPlainRecord(input)) {
    return {
      success: false,
      issues: [
        { code: 'invalid_type', path: [], message: 'Request receipt must be a plain object' },
      ],
    };
  }
  const issues: EventSchemaIssue[] = [];
  rejectUnknownFields(input, REQUEST_RECEIPT_FIELDS, issues, []);
  const batchStateField = readRequiredField(input, 'batchState', issues, []);
  const hasErrorCode = Object.prototype.hasOwnProperty.call(input, 'errorCode');
  const retryableField = readRequiredField(input, 'retryable', issues, []);
  const hasRetryAfterMs = Object.prototype.hasOwnProperty.call(input, 'retryAfterMs');
  const perEventField = readRequiredField(input, 'perEventResults', issues, []);

  const batchState = batchStateField.found
    ? parseState(batchStateField.value, issues, ['batchState'])
    : undefined;
  const errorCode = hasErrorCode
    ? parseErrorCode(input.errorCode, issues, ['errorCode'])
    : undefined;
  const retryable = retryableField.found
    ? parseRetryable(retryableField.value, issues, ['retryable'])
    : undefined;
  const retryAfterMs = hasRetryAfterMs
    ? parseRetryAfterMs(input.retryAfterMs, issues, ['retryAfterMs'])
    : undefined;
  let perEventResults: IngestionEventReceipt[] | undefined;
  if (perEventField.found) {
    if (!Array.isArray(perEventField.value)) {
      addValidationIssue(
        issues,
        'invalid_type',
        ['perEventResults'],
        'perEventResults must be an array',
      );
    } else {
      const parsed: IngestionEventReceipt[] = [];
      for (const [, element] of perEventField.value.entries()) {
        const receiptResult = parseIngestionEventReceipt(element);
        if (!receiptResult.success) {
          issues.push(...receiptResult.issues);
        } else {
          parsed.push(receiptResult.data);
        }
      }
      if (issues.length === 0) perEventResults = parsed;
    }
  }

  if (batchState === undefined || retryable === undefined || perEventResults === undefined) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      batchState,
      ...(errorCode === undefined ? {} : { errorCode }),
      retryable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      perEventResults,
    },
  };
}
