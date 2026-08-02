import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  ErrorCategory,
  ErrorResourceType,
  PromiseRejectionReasonKind,
  type ErrorEventBody,
  type ErrorEventEnvelope,
} from '../error-event-types.js';
import { EventType } from '../event-types.js';

export interface ValidErrorEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: ErrorEventEnvelope;
}

function envelope(eventId: string, body: ErrorEventBody, occurredAt: number): ErrorEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Error,
    occurredAt,
    body,
  };
}

const javascriptMinimum = {
  category: ErrorCategory.JavaScript,
  error: { message: 'Synthetic runtime failure' },
} as const;
const javascriptFull = {
  category: ErrorCategory.JavaScript,
  error: {
    name: 'TypeError',
    message: 'Synthetic runtime failure',
    stack: 'TypeError: Synthetic runtime failure\n    at app.js:1:1',
  },
} as const;
const promiseError = {
  category: ErrorCategory.UnhandledRejection,
  reason: {
    kind: PromiseRejectionReasonKind.Error,
    error: { name: 'Error', message: 'Synthetic Promise rejection' },
  },
} as const;
const promiseString = {
  category: ErrorCategory.UnhandledRejection,
  reason: {
    kind: PromiseRejectionReasonKind.String,
    value: 'Synthetic Promise rejection',
  },
} as const;
const promiseNonStandard = {
  category: ErrorCategory.UnhandledRejection,
  reason: {
    kind: PromiseRejectionReasonKind.NonStandard,
    value: { code: 7, tags: ['synthetic'] },
  },
} as const;
const resourceInput = {
  category: ErrorCategory.Resource,
  resource: {
    type: ErrorResourceType.Script,
    url: 'https://static.example.test/app.js?cache=synthetic#fragment',
  },
} as const;
const resourceExpected = {
  category: ErrorCategory.Resource,
  resource: {
    type: ErrorResourceType.Script,
    url: 'https://static.example.test/app.js',
  },
} as const;

export const validErrorEventSamples: readonly ValidErrorEventSample[] = [
  {
    name: 'minimum JavaScript runtime error',
    input: envelope('evt-error-valid-js-minimum', javascriptMinimum, 1_800_000_003_001),
    expected: envelope('evt-error-valid-js-minimum', javascriptMinimum, 1_800_000_003_001),
  },
  {
    name: 'full JavaScript runtime error',
    input: envelope('evt-error-valid-js-full', javascriptFull, 1_800_000_003_002),
    expected: envelope('evt-error-valid-js-full', javascriptFull, 1_800_000_003_002),
  },
  {
    name: 'Error-style Promise rejection',
    input: envelope('evt-error-valid-promise-error', promiseError, 1_800_000_003_003),
    expected: envelope('evt-error-valid-promise-error', promiseError, 1_800_000_003_003),
  },
  {
    name: 'string Promise rejection',
    input: envelope('evt-error-valid-promise-string', promiseString, 1_800_000_003_004),
    expected: envelope('evt-error-valid-promise-string', promiseString, 1_800_000_003_004),
  },
  {
    name: 'non-standard Promise rejection',
    input: envelope('evt-error-valid-promise-non-standard', promiseNonStandard, 1_800_000_003_005),
    expected: envelope(
      'evt-error-valid-promise-non-standard',
      promiseNonStandard,
      1_800_000_003_005,
    ),
  },
  {
    name: 'resource URL with query and fragment',
    input: envelope('evt-error-valid-resource', resourceInput, 1_800_000_003_006),
    expected: envelope('evt-error-valid-resource', resourceExpected, 1_800_000_003_006),
  },
];
