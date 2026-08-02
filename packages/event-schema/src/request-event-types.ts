import type { EventEnvelope } from './event-envelope.js';
import type { EventType } from './event-types.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const RequestMethod = Object.freeze({
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Head: 'HEAD',
  Options: 'OPTIONS',
} as const);

export type RequestMethod = (typeof RequestMethod)[keyof typeof RequestMethod];

export const RequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);

export type RequestOutcome = (typeof RequestOutcome)[keyof typeof RequestOutcome];

export const REQUEST_EVENT_LIMITS = Object.freeze({
  maxRequestUrlLength: 2048,
  maxStatusCode: 599,
  minStatusCode: 100,
} as const);

export interface RequestEventBody {
  readonly method: RequestMethod;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
}

export interface RequestEventEnvelope extends EventEnvelope {
  readonly eventType: typeof EventType.Request;
  readonly body: RequestEventBody;
}

export interface RequestEventBodyParseSuccess {
  readonly success: true;
  readonly data: RequestEventBody;
}

export type RequestEventBodyParseFailure = EventEnvelopeParseFailure;
export type RequestEventBodyParseResult =
  RequestEventBodyParseSuccess | RequestEventBodyParseFailure;

export interface RequestEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: RequestEventEnvelope;
}

export type RequestEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type RequestEventEnvelopeParseResult =
  RequestEventEnvelopeParseSuccess | RequestEventEnvelopeParseFailure;
