import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  type RequestEventBody,
  type RequestEventEnvelope,
} from '../src/index.js';

describe('request event contract types', () => {
  it('exports the exact stable runtime constants', () => {
    expect(RequestMethod).toEqual({
      Get: 'GET',
      Post: 'POST',
      Put: 'PUT',
      Patch: 'PATCH',
      Delete: 'DELETE',
      Head: 'HEAD',
      Options: 'OPTIONS',
    });
    expect(RequestOutcome).toEqual({
      Success: 'success',
      HttpError: 'http_error',
      NetworkError: 'network_error',
      Timeout: 'timeout',
      Canceled: 'canceled',
    });
    expect(REQUEST_EVENT_LIMITS).toEqual({
      maxRequestUrlLength: 2048,
      maxStatusCode: 599,
      minStatusCode: 100,
    });
    expect(Object.isFrozen(RequestMethod)).toBe(true);
    expect(Object.isFrozen(RequestOutcome)).toBe(true);
    expect(Object.isFrozen(REQUEST_EVENT_LIMITS)).toBe(true);
  });

  it('narrows the request envelope and body types', () => {
    expectTypeOf<RequestEventEnvelope['eventType']>().toEqualTypeOf<'request'>();
    expectTypeOf<RequestEventEnvelope['body']>().toEqualTypeOf<RequestEventBody>();
    expectTypeOf<RequestEventBody['statusCode']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RequestMethod>().toEqualTypeOf<
      'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
    >();
    expectTypeOf<RequestOutcome>().toEqualTypeOf<
      'success' | 'http_error' | 'network_error' | 'timeout' | 'canceled'
    >();
  });
});
