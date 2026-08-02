import { EventType } from '../src/index.js';
import { parsePerformanceEventEnvelope } from '../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('performance event envelope parsing', () => {
  it('parses a valid performance envelope', () => {
    const input = {
      protocolVersion: 1,
      eventId: 'evt-perf-valid',
      eventType: 'performance',
      occurredAt: 1_800_000_005_100,
      body: {
        metricCategory: 'page',
        metricName: 'inp',
        value: 180,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    };
    const result = parsePerformanceEventEnvelope(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.eventType).toBe(EventType.Performance);
    expect(result.data.body).toEqual({
      metricCategory: 'page',
      metricName: 'inp',
      value: 180,
      unit: 'millisecond',
      startedAt: 1_800_000_005_000,
    });
  });

  it('rejects a performance body with a non-performance event type', () => {
    const input = {
      protocolVersion: 1,
      eventId: 'evt-perf-mismatch',
      eventType: 'error',
      occurredAt: 1_800_000_005_101,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    };
    const result = parsePerformanceEventEnvelope(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('event_type_mismatch');
    }
  });

  it('rejects an error body with a performance event type', () => {
    const result = parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: 'evt-perf-mismatch-2',
      eventType: 'performance',
      occurredAt: 1_800_000_005_102,
      body: {
        category: 'javascript_error',
        error: { name: 'TypeError', message: 'x', stack: 'x' },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('missing_required_field');
    }
  });

  it('rejects an unsupported protocol version through the shared envelope parser', () => {
    const result = parsePerformanceEventEnvelope({
      protocolVersion: 2,
      eventId: 'evt-perf-version',
      eventType: 'performance',
      occurredAt: 1_800_000_005_103,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    }
  });

  it('keeps generic envelope issues unchanged', () => {
    const result = parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: '',
      eventType: 'performance',
      occurredAt: 1_800_000_005_104,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // parseEventEnvelope validates a non-empty eventId as invalid_type.
      expect(result.issues.map(({ code }) => code)).toContain('invalid_type');
    }
  });

  it('uses the same body path for body and envelope parsing', () => {
    const bodyResult = parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: 'evt-perf-path',
      eventType: 'performance',
      occurredAt: 1_800_000_005_105,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
        extra: true,
      },
    });
    expect(bodyResult.success).toBe(false);
    if (!bodyResult.success) {
      const unknownIssue = bodyResult.issues.find((issue) => issue.code === 'unknown_field');
      expect(unknownIssue?.path).toEqual(['body', 'extra']);
    }
  });

  it('is a deterministic non-throwing parser that does not modify input', () => {
    const input = Object.freeze({
      protocolVersion: 1,
      eventId: 'evt-perf-frozen',
      eventType: 'performance',
      occurredAt: 1_800_000_005_106,
      body: {
        metricCategory: 'page',
        metricName: 'cls',
        value: 0.05,
        unit: 'ratio',
        startedAt: 1_800_000_005_000,
      },
    });
    const before = JSON.stringify(input);
    const result = parsePerformanceEventEnvelope(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(typeof result).toBe('object');
  });
});
