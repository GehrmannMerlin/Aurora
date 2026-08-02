import {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  type BrowserRequestSourceEvent,
} from '@aurora/browser';
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  parseRequestEventBody,
  type RequestEventBodyParseFailure,
  type RequestEventBodyParseSuccess,
} from '@aurora/event-schema';

export type RequestBodyConversionResult =
  | RequestEventBodyParseSuccess
  | { readonly success: false; readonly code: 'unsupported_method' }
  | { readonly success: false; readonly code: 'invalid_browser_fact' }
  | RequestEventBodyParseFailure;

function normalizeMethod(method: string): RequestMethod | null {
  const upper = method.toUpperCase();
  if (upper === RequestMethod.Get) return RequestMethod.Get;
  if (upper === RequestMethod.Post) return RequestMethod.Post;
  if (upper === RequestMethod.Put) return RequestMethod.Put;
  if (upper === RequestMethod.Patch) return RequestMethod.Patch;
  if (upper === RequestMethod.Delete) return RequestMethod.Delete;
  if (upper === RequestMethod.Head) return RequestMethod.Head;
  if (upper === RequestMethod.Options) return RequestMethod.Options;
  return null;
}

function normalizeOutcome(outcome: string): RequestOutcome | null {
  if (outcome === BrowserRequestOutcome.Success) return RequestOutcome.Success;
  if (outcome === BrowserRequestOutcome.HttpError) return RequestOutcome.HttpError;
  if (outcome === BrowserRequestOutcome.NetworkError) return RequestOutcome.NetworkError;
  if (outcome === BrowserRequestOutcome.Timeout) return RequestOutcome.Timeout;
  if (outcome === BrowserRequestOutcome.Canceled) return RequestOutcome.Canceled;
  return null;
}

export function createRequestEventConverter() {
  function convert(event: BrowserRequestSourceEvent): RequestBodyConversionResult {
    const method = normalizeMethod(event.method);
    if (method === null) {
      return { success: false, code: 'unsupported_method' };
    }
    const outcome = normalizeOutcome(event.outcome);
    if (outcome === null) {
      return { success: false, code: 'invalid_browser_fact' };
    }
    if (
      !Number.isSafeInteger(event.startedAt) ||
      event.startedAt <= 0 ||
      !Number.isFinite(event.durationMs) ||
      event.durationMs < 0
    ) {
      return { success: false, code: 'invalid_browser_fact' };
    }
    if (
      event.statusCode !== null &&
      (!Number.isSafeInteger(event.statusCode) ||
        event.statusCode < REQUEST_EVENT_LIMITS.minStatusCode ||
        event.statusCode > REQUEST_EVENT_LIMITS.maxStatusCode)
    ) {
      return { success: false, code: 'invalid_browser_fact' };
    }
    const candidate: unknown = {
      method,
      url: event.url,
      startedAt: event.startedAt,
      durationMs: Math.round(event.durationMs),
      outcome,
      ...(event.statusCode === null ? {} : { statusCode: event.statusCode }),
    };
    return parseRequestEventBody(candidate);
  }
  return Object.freeze({ convert });
}

export function isFetchMechanism(event: BrowserRequestSourceEvent): boolean {
  return event.mechanism === BrowserRequestMechanism.Fetch;
}
