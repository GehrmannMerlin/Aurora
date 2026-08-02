import { BrowserErrorSourceEventType, type BrowserErrorSourceEvent } from '@aurora/browser';
import type { CoreEventDraftResult, CorePluginContext } from '@aurora/core';
import { ErrorCategory, EventType, parseErrorEventBody } from '@aurora/event-schema';
import { describe, expect, it, vi } from 'vitest';
import { createErrorCaptureDiagnosticStore } from '../src/diagnostics.js';
import { createErrorSourceHandler } from '../src/source-event-handler.js';

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

const javascriptEvent: BrowserErrorSourceEvent = Object.freeze({
  type: BrowserErrorSourceEventType.JavaScript,
  message: 'Synthetic JavaScript failure',
  sourceUrl: null,
  error: new Error('Synthetic JavaScript failure'),
});
const promiseEvent: BrowserErrorSourceEvent = Object.freeze({
  type: BrowserErrorSourceEventType.UnhandledRejection,
  reason: 'Synthetic rejection',
});
const resourceEvent: BrowserErrorSourceEvent = Object.freeze({
  type: BrowserErrorSourceEventType.Resource,
  tagName: 'script',
  sourceUrl: 'https://static.example.test/app.js?token=private#fragment',
  rel: null,
  as: null,
});

describe('error source submission', () => {
  it('submits each source exactly once as an exact validated Core draft', () => {
    const drafts: unknown[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = vi.fn((input: unknown) => {
      drafts.push(input);
      return accepted;
    });
    const diagnostics = createErrorCaptureDiagnosticStore();
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    handler.handle(resourceEvent);
    expect(drafts).toHaveLength(3);
    for (const draft of drafts) {
      if (typeof draft !== 'object' || draft === null) throw new Error('draft must be an object');
      expect(Reflect.ownKeys(draft)).toEqual(['eventType', 'body']);
      expect(draft).toMatchObject({ eventType: EventType.Error });
      const body: unknown = Reflect.get(draft, 'body');
      expect(parseErrorEventBody(body).success).toBe(true);
      expect(Reflect.has(draft, 'eventId')).toBe(false);
      expect(Reflect.has(draft, 'occurredAt')).toBe(false);
      expect(Reflect.has(draft, 'protocolVersion')).toBe(false);
    }
    expect(diagnostics.snapshot()).toEqual([]);
  });

  it('does not submit rejected schema input and accepts the next event', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createErrorCaptureDiagnosticStore();
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle({
      type: BrowserErrorSourceEventType.Resource,
      tagName: 'script',
      sourceUrl: null,
      rel: null,
      as: null,
    });
    handler.handle(javascriptEvent);
    expect(submitEvent).toHaveBeenCalledTimes(1);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'error_body_rejected', operation: 'convert', sourceType: 'resource_error' },
    ]);
  });

  it('records a Core failure and submits the next event', () => {
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockReturnValueOnce(rejected)
      .mockReturnValueOnce(accepted);
    const diagnostics = createErrorCaptureDiagnosticStore();
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit' },
    ]);
  });

  it('blocks synchronous recursion without suppressing the next independent event', () => {
    const diagnostics = createErrorCaptureDiagnosticStore();
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) handler.handle(promiseEvent);
      return accepted;
    };
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'recursive_capture_blocked', operation: 'notify' },
    ]);
  });

  it('maps all three public categories without retaining input wrappers', () => {
    const categories: string[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = (input: unknown) => {
      if (typeof input !== 'object' || input === null) throw new Error('draft must be an object');
      const body: unknown = Reflect.get(input, 'body');
      const parsed = parseErrorEventBody(body);
      if (!parsed.success) throw new Error('body must be valid');
      categories.push(parsed.data.category);
      return accepted;
    };
    const handler = createErrorSourceHandler(submitEvent, createErrorCaptureDiagnosticStore());
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    handler.handle(resourceEvent);
    expect(categories).toEqual([
      ErrorCategory.JavaScript,
      ErrorCategory.UnhandledRejection,
      ErrorCategory.Resource,
    ]);
  });
});
