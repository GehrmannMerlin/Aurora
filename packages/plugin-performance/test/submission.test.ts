import type { BrowserPerformanceSourceEvent } from '@aurora/browser';
import type { CoreEventDraftResult, CorePluginContext } from '@aurora/core';
import { EventType, parsePerformanceEventBody } from '@aurora/event-schema';
import { describe, expect, it, vi } from 'vitest';
import { createPerformanceCaptureDiagnosticStore } from '../src/diagnostics.js';
import { createPerformanceSourceHandler } from '../src/performance-source-handler.js';

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

const lcpFact: BrowserPerformanceSourceEvent = Object.freeze({
  metricName: 'lcp',
  value: 2500,
  unit: 'millisecond',
  startedAt: 1800000005000,
});
const clsFact: BrowserPerformanceSourceEvent = Object.freeze({
  metricName: 'cls',
  value: 0.125,
  unit: 'ratio',
  startedAt: 1800000005000,
});

describe('performance source submission', () => {
  it('submits each performance fact exactly once as an exact validated Core draft', () => {
    const drafts: unknown[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = vi.fn((input: unknown) => {
      drafts.push(input);
      return accepted;
    });
    const diagnostics = createPerformanceCaptureDiagnosticStore();
    const handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    handler.handle(lcpFact);
    handler.handle(clsFact);
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) {
      if (typeof draft !== 'object' || draft === null) throw new Error('draft must be an object');
      expect(Reflect.ownKeys(draft)).toEqual(['eventType', 'body']);
      expect(draft).toMatchObject({ eventType: EventType.Performance });
      const body: unknown = Reflect.get(draft, 'body');
      expect(parsePerformanceEventBody(body).success).toBe(true);
      expect(Reflect.has(draft, 'eventId')).toBe(false);
      expect(Reflect.has(draft, 'occurredAt')).toBe(false);
      expect(Reflect.has(draft, 'protocolVersion')).toBe(false);
    }
    expect(diagnostics.snapshot()).toEqual([]);
  });

  it('does not submit invalid performance facts', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createPerformanceCaptureDiagnosticStore();
    const handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    handler.handle({ ...lcpFact, startedAt: 0 });
    expect(submitEvent).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'performance_schema_rejected', operation: 'convert', metricName: 'lcp' },
    ]);
  });

  it('does not submit facts with unknown metric names', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createPerformanceCaptureDiagnosticStore();
    const handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    handler.handle({ ...lcpFact, metricName: 'fcp' as never });
    expect(submitEvent).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'performance_fact_invalid', operation: 'convert', metricName: 'fcp' },
    ]);
  });

  it('records a Core failure and submits the next fact', () => {
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockReturnValueOnce(rejected)
      .mockReturnValueOnce(accepted);
    const diagnostics = createPerformanceCaptureDiagnosticStore();
    const handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    handler.handle(lcpFact);
    handler.handle(clsFact);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit', metricName: 'lcp' },
    ]);
  });

  it('blocks synchronous recursion without suppressing the next independent fact', () => {
    const diagnostics = createPerformanceCaptureDiagnosticStore();
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) handler.handle(clsFact);
      return accepted;
    };
    const handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    handler.handle(lcpFact);
    handler.handle(clsFact);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'recursive_capture_blocked', operation: 'notify', metricName: 'cls' },
    ]);
  });

  it('contains conversion exceptions and handles the next fact', () => {
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockImplementationOnce(() => {
        throw new Error('authorization=private');
      })
      .mockReturnValueOnce(accepted);
    const diagnostics = createPerformanceCaptureDiagnosticStore();
    const handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    handler.handle(lcpFact);
    handler.handle(clsFact);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(diagnostics.snapshot())).not.toContain('authorization');
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'internal_error', operation: 'notify', metricName: 'lcp' },
    ]);
  });
});
