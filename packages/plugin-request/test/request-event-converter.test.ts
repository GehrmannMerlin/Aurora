import {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  type BrowserFetchRequestSourceEvent,
  type BrowserXhrRequestSourceEvent,
} from '@aurora/browser';
import { parseRequestEventBody, RequestMethod, RequestOutcome } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { createRequestEventConverter } from '../src/request-event-converter.js';

const converter = createRequestEventConverter();

function fetchEvent(
  overrides: Partial<BrowserFetchRequestSourceEvent> = {},
): BrowserFetchRequestSourceEvent {
  return Object.freeze({
    mechanism: BrowserRequestMechanism.Fetch,
    method: 'GET',
    url: 'https://api.example.test/orders',
    startedAt: 1800000005000,
    durationMs: 120,
    outcome: BrowserRequestOutcome.Success,
    statusCode: 200,
    ...overrides,
  });
}

function xhrEvent(
  overrides: Partial<BrowserXhrRequestSourceEvent> = {},
): BrowserXhrRequestSourceEvent {
  return Object.freeze({
    mechanism: BrowserRequestMechanism.XmlHttpRequest,
    method: 'POST',
    url: 'https://api.example.test/orders',
    startedAt: 1800000005000,
    durationMs: 250,
    outcome: BrowserRequestOutcome.Success,
    statusCode: 201,
    ...overrides,
  });
}

describe('request event converter', () => {
  it('maps a successful fetch fact to a valid request body', () => {
    const result = converter.convert(fetchEvent());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data).toEqual({
      method: RequestMethod.Get,
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: RequestOutcome.Success,
      statusCode: 200,
    });
    expect(parseRequestEventBody(result.data).success).toBe(true);
  });

  it('maps an HTTP-error fetch fact to http_error with its status code', () => {
    const result = converter.convert(
      fetchEvent({ outcome: BrowserRequestOutcome.HttpError, statusCode: 500 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.outcome).toBe(RequestOutcome.HttpError);
    expect(result.data.statusCode).toBe(500);
  });

  it('maps a network-error fetch fact and omits statusCode when null', () => {
    const result = converter.convert(
      fetchEvent({ outcome: BrowserRequestOutcome.NetworkError, statusCode: null }),
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.outcome).toBe(RequestOutcome.NetworkError);
    expect('statusCode' in result.data).toBe(false);
  });

  it('normalizes lowercase standard methods', () => {
    for (const lower of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const result = converter.convert(fetchEvent({ method: lower }));
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(`must succeed for ${lower}`);
      expect(parseRequestEventBody(result.data).success).toBe(true);
    }
  });

  it('rejects non-standard methods without submitting', () => {
    const result = converter.convert(fetchEvent({ method: 'CONNECT' }));
    expect(result).toEqual({ success: false, code: 'unsupported_method' });
  });

  it('keeps the input event unchanged', () => {
    const event = fetchEvent();
    const snapshot = JSON.stringify(event);
    converter.convert(event);
    expect(JSON.stringify(event)).toBe(snapshot);
  });

  it('maps a successful XHR load fact', () => {
    const result = converter.convert(xhrEvent());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data).toMatchObject({
      method: RequestMethod.Post,
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 250,
      outcome: RequestOutcome.Success,
      statusCode: 201,
    });
  });

  it('maps XHR timeout and canceled facts', () => {
    const timeout = converter.convert(
      xhrEvent({ outcome: BrowserRequestOutcome.Timeout, statusCode: null }),
    );
    expect(timeout.success).toBe(true);
    if (!timeout.success) throw new Error('must succeed');
    expect(timeout.data.outcome).toBe(RequestOutcome.Timeout);

    const canceled = converter.convert(
      xhrEvent({ outcome: BrowserRequestOutcome.Canceled, statusCode: null }),
    );
    expect(canceled.success).toBe(true);
    if (!canceled.success) throw new Error('must succeed');
    expect(canceled.data.outcome).toBe(RequestOutcome.Canceled);
  });

  it('rounds fractional durationMs to a safe integer', () => {
    const result = converter.convert(fetchEvent({ durationMs: 120.6 }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.durationMs).toBe(121);
  });

  it('rejects invalid browser facts', () => {
    expect(converter.convert(fetchEvent({ startedAt: 0 }))).toEqual({
      success: false,
      code: 'invalid_browser_fact',
    });
    expect(converter.convert(fetchEvent({ durationMs: -1 }))).toEqual({
      success: false,
      code: 'invalid_browser_fact',
    });
    expect(converter.convert(fetchEvent({ statusCode: 700 }))).toEqual({
      success: false,
      code: 'invalid_browser_fact',
    });
  });
});
