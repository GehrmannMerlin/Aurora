import { type BrowserRequestSourceEvent } from '@aurora/browser';
import type { CoreEventDraftResult, CorePluginContext } from '@aurora/core';
import { EventType, parseRequestEventBody } from '@aurora/event-schema';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCaptureDiagnosticStore } from '../src/diagnostics.js';
import { createRequestSourceHandler } from '../src/request-source-handler.js';

const accepted: CoreEventDraftResult = Object.freeze({
  ok: true,
  code: 'accepted',
  state: 'started',
  diagnosticsAdded: 0,
});
const rejected: CoreEventDraftResult = Object.freeze({
  ok: false,
  code: 'not_started',
  state: 'stopped',
  diagnosticsAdded: 1,
});

const fetchSuccessEvent: BrowserRequestSourceEvent = Object.freeze({
  mechanism: 'fetch',
  method: 'GET',
  url: 'https://api.example.test/orders?token=private#fragment',
  startedAt: 1800000005000,
  durationMs: 120.6,
  outcome: 'success',
  statusCode: 200,
});
const xhrTimeoutEvent: BrowserRequestSourceEvent = Object.freeze({
  mechanism: 'xhr',
  method: 'POST',
  url: 'https://api.example.test/orders',
  startedAt: 1800000005000,
  durationMs: 3000,
  outcome: 'timeout',
  statusCode: null,
});

describe('request source submission', () => {
  it('submits each source exactly once as an exact validated Core draft', () => {
    const drafts: unknown[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = vi.fn((input: unknown) => {
      drafts.push(input);
      return accepted;
    });
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) {
      if (typeof draft !== 'object' || draft === null) throw new Error('draft must be an object');
      expect(Reflect.ownKeys(draft)).toEqual(['eventType', 'body']);
      expect(draft).toMatchObject({ eventType: EventType.Request });
      const body: unknown = Reflect.get(draft, 'body');
      expect(parseRequestEventBody(body).success).toBe(true);
      expect(Reflect.has(draft, 'eventId')).toBe(false);
      expect(Reflect.has(draft, 'occurredAt')).toBe(false);
      expect(Reflect.has(draft, 'protocolVersion')).toBe(false);
    }
    expect(diagnostics.snapshot()).toEqual([]);
  });

  it('does not submit when the schema rejects a valid-shaped but out-of-range body', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    const tooLongUrl = `https://api.example.test/${'a'.repeat(2048)}`;
    handler.handle({ ...fetchSuccessEvent, url: tooLongUrl });
    handler.handle(fetchSuccessEvent);
    expect(submitEvent).toHaveBeenCalledTimes(1);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'request_body_rejected', operation: 'convert', mechanism: 'fetch' },
    ]);
  });

  it('does not submit unsupported methods', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle({ ...fetchSuccessEvent, method: 'CONNECT' });
    expect(submitEvent).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'unsupported_method', operation: 'convert', mechanism: 'fetch' },
    ]);
  });

  it('does not submit invalid browser facts', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle({ ...fetchSuccessEvent, startedAt: 0 });
    expect(submitEvent).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'invalid_browser_fact', operation: 'convert', mechanism: 'fetch' },
    ]);
  });

  it('records a Core failure and submits the next event', () => {
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockReturnValueOnce(rejected)
      .mockReturnValueOnce(accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit', mechanism: 'fetch' },
    ]);
  });

  it('blocks synchronous recursion without suppressing the next independent event', () => {
    const diagnostics = createRequestCaptureDiagnosticStore();
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) handler.handle(fetchSuccessEvent);
      return accepted;
    };
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'recursive_capture_blocked', operation: 'notify', mechanism: 'fetch' },
    ]);
  });

  it('maps fetch and xhr mechanisms into diagnostics', () => {
    const diagnostics = createRequestCaptureDiagnosticStore();
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) {
        return Object.freeze({
          ok: false,
          code: 'not_started',
          state: 'stopped',
          diagnosticsAdded: 1,
        });
      }
      return accepted;
    };
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit', mechanism: 'fetch' },
    ]);
  });
});
