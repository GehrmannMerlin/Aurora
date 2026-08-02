import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  RequestMethod,
  RequestOutcome,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '../request-event-types.js';
import { EventType } from '../event-types.js';

export interface ValidRequestEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: RequestEventEnvelope;
}

function envelope(
  eventId: string,
  body: RequestEventBody,
  occurredAt: number,
): RequestEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Request,
    occurredAt,
    body,
  };
}

const getSuccess = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/orders',
  startedAt: 1_800_000_005_000,
  durationMs: 120,
  outcome: RequestOutcome.Success,
  statusCode: 200,
} as const;
const postSuccess = {
  method: RequestMethod.Post,
  url: 'https://api.example.test/orders',
  startedAt: 1_800_000_005_001,
  durationMs: 45,
  outcome: RequestOutcome.Success,
} as const;
const deleteHttpError = {
  method: RequestMethod.Delete,
  url: 'https://api.example.test/orders/7',
  startedAt: 1_800_000_005_002,
  durationMs: 810,
  outcome: RequestOutcome.HttpError,
  statusCode: 500,
} as const;
const getNetworkError = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/reports',
  startedAt: 1_800_000_005_003,
  durationMs: 1500,
  outcome: RequestOutcome.NetworkError,
} as const;
const postTimeout = {
  method: RequestMethod.Post,
  url: 'https://api.example.test/upload',
  startedAt: 1_800_000_005_004,
  durationMs: 3005,
  outcome: RequestOutcome.Timeout,
} as const;
const getCanceled = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/search',
  startedAt: 1_800_000_005_005,
  durationMs: 210,
  outcome: RequestOutcome.Canceled,
} as const;
const queryInput = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/search?token=private#fragment',
  startedAt: 1_800_000_005_006,
  durationMs: 90,
  outcome: RequestOutcome.Success,
  statusCode: 200,
} as const;
const queryExpected = {
  method: RequestMethod.Get,
  url: 'https://api.example.test/search',
  startedAt: 1_800_000_005_006,
  durationMs: 90,
  outcome: RequestOutcome.Success,
  statusCode: 200,
} as const;

export const validRequestEventSamples: readonly ValidRequestEventSample[] = [
  {
    name: 'successful GET with status code',
    input: envelope('evt-request-valid-get', getSuccess, 1_800_000_005_500),
    expected: envelope('evt-request-valid-get', getSuccess, 1_800_000_005_500),
  },
  {
    name: 'successful POST without status code',
    input: envelope('evt-request-valid-post', postSuccess, 1_800_000_005_501),
    expected: envelope('evt-request-valid-post', postSuccess, 1_800_000_005_501),
  },
  {
    name: 'HTTP 500 response',
    input: envelope('evt-request-valid-delete', deleteHttpError, 1_800_000_005_502),
    expected: envelope('evt-request-valid-delete', deleteHttpError, 1_800_000_005_502),
  },
  {
    name: 'network failure without status',
    input: envelope('evt-request-valid-network', getNetworkError, 1_800_000_005_503),
    expected: envelope('evt-request-valid-network', getNetworkError, 1_800_000_005_503),
  },
  {
    name: 'timeout without status',
    input: envelope('evt-request-valid-timeout', postTimeout, 1_800_000_005_504),
    expected: envelope('evt-request-valid-timeout', postTimeout, 1_800_000_005_504),
  },
  {
    name: 'canceled request',
    input: envelope('evt-request-valid-canceled', getCanceled, 1_800_000_005_505),
    expected: envelope('evt-request-valid-canceled', getCanceled, 1_800_000_005_505),
  },
  {
    name: 'GET with query and fragment stripped',
    input: envelope('evt-request-valid-query', queryInput, 1_800_000_005_506),
    expected: envelope('evt-request-valid-query', queryExpected, 1_800_000_005_506),
  },
];
