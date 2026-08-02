import { CURRENT_PROTOCOL_VERSION, EVENT_SCHEMA_LIMITS } from '../constants.js';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
  type ErrorEventBody,
  type ErrorEventEnvelope,
  type SafeErrorObject,
  type SafeErrorValue,
} from '../error-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: ErrorEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function envelope(eventId: string, body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Error,
    occurredAt: 1_800_000_003_200,
    body,
  };
}

function expectedEnvelope(eventId: string, body: ErrorEventBody): ErrorEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Error,
    occurredAt: 1_800_000_003_200,
    body,
  };
}

function nestedValue(depth: number): SafeErrorValue {
  let value: SafeErrorValue = null;
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

const urlPrefix = 'https://static.example.test/';
const maximumUrl =
  urlPrefix + 'a'.repeat(ERROR_EVENT_LIMITS.maxResourceUrlLength - urlPrefix.length);
const maximumReasonNesting = EVENT_SCHEMA_LIMITS.maxObjectDepth - 2;
const maximumObjectValue: SafeErrorObject = Object.fromEntries(
  Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys }, (_, index) => [
    `field${String(index)}`,
    null,
  ]),
);

const maximumJavascriptBody = {
  category: ErrorCategory.JavaScript,
  error: {
    name: 'n'.repeat(ERROR_EVENT_LIMITS.maxErrorNameLength),
    message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength),
    stack: 's'.repeat(ERROR_EVENT_LIMITS.maxStackLength),
  },
} as const;
const maximumResourceBody = {
  category: ErrorCategory.Resource,
  resource: { type: ErrorResourceType.Font, url: maximumUrl },
} as const;

export const boundaryErrorEventSamples: readonly BoundaryErrorEventSample[] = [
  {
    name: 'all JavaScript strings at exact maximum',
    input: envelope('evt-error-boundary-js-max', maximumJavascriptBody),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-js-max', maximumJavascriptBody),
  },
  {
    name: 'JavaScript message one over maximum',
    input: envelope('evt-error-boundary-message-over', {
      category: ErrorCategory.JavaScript,
      error: { message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength + 1) },
    }),
    isValid: false,
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'Promise string at exact maximum',
    input: envelope('evt-error-boundary-promise-string-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.String,
        value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength),
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-promise-string-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.String,
        value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength),
      },
    }),
  },
  {
    name: 'Promise array at exact maximum',
    input: envelope('evt-error-boundary-array-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null),
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-array-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null),
      },
    }),
  },
  {
    name: 'Promise array one over maximum',
    input: envelope('evt-error-boundary-array-over', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null),
      },
    }),
    isValid: false,
    expectedIssueCode: 'array_too_large',
  },
  {
    name: 'Promise object at exact maximum key count',
    input: envelope('evt-error-boundary-object-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: maximumObjectValue,
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-object-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: maximumObjectValue,
      },
    }),
  },
  {
    name: 'Promise object one over maximum key count',
    input: envelope('evt-error-boundary-object-over', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: Object.fromEntries(
          Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
            `field${String(index)}`,
            null,
          ]),
        ),
      },
    }),
    isValid: false,
    expectedIssueCode: 'object_too_large',
  },
  {
    name: 'Promise value at exact remaining body depth',
    input: envelope('evt-error-boundary-depth-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: nestedValue(maximumReasonNesting),
      },
    }),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-depth-max', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: nestedValue(maximumReasonNesting),
      },
    }),
  },
  {
    name: 'Promise value one over remaining body depth',
    input: envelope('evt-error-boundary-depth-over', {
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.NonStandard,
        value: nestedValue(maximumReasonNesting + 1),
      },
    }),
    isValid: false,
    expectedIssueCode: 'object_too_deep',
  },
  {
    name: 'resource URL at exact maximum',
    input: envelope('evt-error-boundary-url-max', maximumResourceBody),
    isValid: true,
    expected: expectedEnvelope('evt-error-boundary-url-max', maximumResourceBody),
  },
  {
    name: 'resource URL one over maximum',
    input: envelope('evt-error-boundary-url-over', {
      category: ErrorCategory.Resource,
      resource: { type: ErrorResourceType.Font, url: `${maximumUrl}a` },
    }),
    isValid: false,
    expectedIssueCode: 'string_too_long',
  },
];
