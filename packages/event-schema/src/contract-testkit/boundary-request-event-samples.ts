import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '../request-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: RequestEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function envelope(eventId: string, body: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Request,
    occurredAt: 1_800_000_005_700,
    body,
  };
}

function expectedEnvelope(eventId: string, body: RequestEventBody): RequestEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Request,
    occurredAt: 1_800_000_005_700,
    body,
  };
}

const urlPrefix = 'https://api.example.test/';
const maximumUrl =
  urlPrefix + 'a'.repeat(REQUEST_EVENT_LIMITS.maxRequestUrlLength - urlPrefix.length);
const maximumSafeInteger = Number.MAX_SAFE_INTEGER;

export const boundaryRequestEventSamples: readonly BoundaryRequestEventSample[] = [
  {
    name: 'URL at exact maximum',
    input: envelope('evt-request-boundary-url-max', {
      method: RequestMethod.Get,
      url: maximumUrl,
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-url-max', {
      method: RequestMethod.Get,
      url: maximumUrl,
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
  },
  {
    name: 'URL one over maximum',
    input: envelope('evt-request-boundary-url-over', {
      method: RequestMethod.Get,
      url: `${maximumUrl}a`,
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
    isValid: false,
    expectedIssueCode: 'string_too_long',
  },
  {
    name: 'zero duration is valid',
    input: envelope('evt-request-boundary-duration-zero', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/ping',
      startedAt: 1,
      durationMs: 0,
      outcome: RequestOutcome.Success,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-duration-zero', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/ping',
      startedAt: 1,
      durationMs: 0,
      outcome: RequestOutcome.Success,
    }),
  },
  {
    name: 'duration at maximum safe integer',
    input: envelope('evt-request-boundary-duration-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/slow',
      startedAt: 1,
      durationMs: maximumSafeInteger,
      outcome: RequestOutcome.Timeout,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-duration-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/slow',
      startedAt: 1,
      durationMs: maximumSafeInteger,
      outcome: RequestOutcome.Timeout,
    }),
  },
  {
    name: 'startedAt at maximum safe integer',
    input: envelope('evt-request-boundary-started-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/orders',
      startedAt: maximumSafeInteger,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-started-max', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/orders',
      startedAt: maximumSafeInteger,
      durationMs: 1,
      outcome: RequestOutcome.Success,
    }),
  },
  {
    name: 'status code 100',
    input: envelope('evt-request-boundary-status-100', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
      statusCode: 100,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-status-100', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.Success,
      statusCode: 100,
    }),
  },
  {
    name: 'status code 599',
    input: envelope('evt-request-boundary-status-599', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
      statusCode: 599,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-status-599', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
      statusCode: 599,
    }),
  },
  {
    name: 'status code 600 rejected',
    input: envelope('evt-request-boundary-status-600', {
      method: RequestMethod.Get,
      url: 'https://api.example.test/status',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
      statusCode: 600,
    }),
    isValid: false,
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'http_error without status code is allowed',
    input: envelope('evt-request-boundary-no-status', {
      method: RequestMethod.Delete,
      url: 'https://api.example.test/orders/7',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
    }),
    isValid: true,
    expected: expectedEnvelope('evt-request-boundary-no-status', {
      method: RequestMethod.Delete,
      url: 'https://api.example.test/orders/7',
      startedAt: 1,
      durationMs: 1,
      outcome: RequestOutcome.HttpError,
    }),
  },
];
