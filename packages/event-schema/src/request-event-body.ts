import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  type RequestEventBodyParseResult,
} from './request-event-types.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import { sanitizeHttpUrl } from './safe-url.js';
import type { EventSchemaIssue } from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

const REQUEST_BODY_FIELDS: ReadonlySet<string> = new Set([
  'method',
  'url',
  'startedAt',
  'durationMs',
  'outcome',
  'statusCode',
]);
const requestMethods: ReadonlySet<unknown> = new Set(Object.values(RequestMethod));
const requestOutcomes: ReadonlySet<unknown> = new Set(Object.values(RequestOutcome));

function unsafeBodyFailure(): RequestEventBodyParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: ['body'],
        message: 'Request event body could not be read safely',
      },
    ],
  };
}

function parseMethod(input: unknown, issues: EventSchemaIssue[]): RequestMethod | undefined {
  const path = ['body', 'method'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Request method must be a string');
    return undefined;
  }
  if (!requestMethods.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Request method is not supported');
    return undefined;
  }
  if (input === RequestMethod.Get) return RequestMethod.Get;
  if (input === RequestMethod.Post) return RequestMethod.Post;
  if (input === RequestMethod.Put) return RequestMethod.Put;
  if (input === RequestMethod.Patch) return RequestMethod.Patch;
  if (input === RequestMethod.Delete) return RequestMethod.Delete;
  if (input === RequestMethod.Head) return RequestMethod.Head;
  return RequestMethod.Options;
}

function parseOutcome(input: unknown, issues: EventSchemaIssue[]): RequestOutcome | undefined {
  const path = ['body', 'outcome'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Request outcome must be a string');
    return undefined;
  }
  if (!requestOutcomes.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Request outcome is not supported');
    return undefined;
  }
  if (input === RequestOutcome.Success) return RequestOutcome.Success;
  if (input === RequestOutcome.HttpError) return RequestOutcome.HttpError;
  if (input === RequestOutcome.NetworkError) return RequestOutcome.NetworkError;
  if (input === RequestOutcome.Timeout) return RequestOutcome.Timeout;
  return RequestOutcome.Canceled;
}

function parseStartedAt(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'startedAt'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'startedAt must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input <= 0) {
    addValidationIssue(
      issues,
      'invalid_timestamp',
      path,
      'startedAt must be a positive safe integer in Unix epoch milliseconds',
    );
    return undefined;
  }
  return input;
}

function parseDurationMs(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'durationMs'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'durationMs must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input < 0) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'durationMs must be a non-negative safe integer',
    );
    return undefined;
  }
  return input;
}

function parseStatusCode(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'statusCode'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'statusCode must be a number');
    return undefined;
  }
  if (
    !Number.isSafeInteger(input) ||
    input < REQUEST_EVENT_LIMITS.minStatusCode ||
    input > REQUEST_EVENT_LIMITS.maxStatusCode
  ) {
    addValidationIssue(
      issues,
      'invalid_number',
      path,
      'statusCode must be a safe integer between 100 and 599',
    );
    return undefined;
  }
  return input;
}

function parseBody(input: unknown): RequestEventBodyParseResult {
  const issues: EventSchemaIssue[] = [];
  validateBodyValue(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (!isPlainRecord(input)) {
    addValidationIssue(
      issues,
      'invalid_type',
      ['body'],
      'Request event body must be a plain object',
    );
    return { success: false, issues };
  }
  rejectUnknownFields(input, REQUEST_BODY_FIELDS, issues, ['body']);
  const methodField = readRequiredField(input, 'method', issues, ['body']);
  const urlField = readRequiredField(input, 'url', issues, ['body']);
  const startedAtField = readRequiredField(input, 'startedAt', issues, ['body']);
  const durationMsField = readRequiredField(input, 'durationMs', issues, ['body']);
  const outcomeField = readRequiredField(input, 'outcome', issues, ['body']);
  const hasStatusCode = Object.prototype.hasOwnProperty.call(input, 'statusCode');
  const method = methodField.found ? parseMethod(methodField.value, issues) : undefined;
  const url = urlField.found
    ? sanitizeHttpUrl(urlField.value, REQUEST_EVENT_LIMITS.maxRequestUrlLength, issues, [
        'body',
        'url',
      ])
    : undefined;
  const startedAt = startedAtField.found ? parseStartedAt(startedAtField.value, issues) : undefined;
  const durationMs = durationMsField.found
    ? parseDurationMs(durationMsField.value, issues)
    : undefined;
  const outcome = outcomeField.found ? parseOutcome(outcomeField.value, issues) : undefined;
  const statusCode = hasStatusCode ? parseStatusCode(input.statusCode, issues) : undefined;
  if (
    issues.length > 0 ||
    method === undefined ||
    url === undefined ||
    startedAt === undefined ||
    durationMs === undefined ||
    outcome === undefined ||
    (hasStatusCode && statusCode === undefined)
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      method,
      url,
      startedAt,
      durationMs,
      outcome,
      ...(statusCode === undefined ? {} : { statusCode }),
    },
  };
}

export function parseRequestEventBody(input: unknown): RequestEventBodyParseResult {
  try {
    return parseBody(input);
  } catch {
    return unsafeBodyFailure();
  }
}
