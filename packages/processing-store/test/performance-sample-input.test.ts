import { describe, expect, it } from 'vitest';
import { parsePersistPerformanceEventSampleInput } from '../src/performance-sample-input.js';

function performanceEnvelope(eventId: string, bodyOverrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_054_000,
    body: {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
      ...bodyOverrides,
    },
  };
}

describe('parsePersistPerformanceEventSampleInput', () => {
  it('derives a whitelist projection from a valid performance envelope', () => {
    const result = parsePersistPerformanceEventSampleInput({
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-1'),
    });
    expect(result).toMatchObject({
      projectId: '11111111-1111-1111-1111-111111111111',
      eventId: 'evt-perf-sample-1',
      occurredAtIso: '2027-01-15T08:00:54.000Z',
    });
    const body = (result as { sampleBody: Record<string, unknown> }).sampleBody;
    expect(body).toEqual({
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
    });
  });

  it('includes durationMs in the projection when present', () => {
    const result = parsePersistPerformanceEventSampleInput({
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-dur', { durationMs: 300 }),
    });
    const body = (result as { sampleBody: Record<string, unknown> }).sampleBody;
    expect(body).toMatchObject({ durationMs: 300 });
  });

  it('rejects a non-object top level', () => {
    expect(parsePersistPerformanceEventSampleInput(null)).toMatchObject({
      status: 'invalid_input',
    });
  });

  it('rejects a missing projectId', () => {
    expect(
      parsePersistPerformanceEventSampleInput({ eventEnvelope: performanceEnvelope('evt-x') }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a non-performance envelope', () => {
    expect(
      parsePersistPerformanceEventSampleInput({
        projectId: '11111111-1111-1111-1111-111111111111',
        eventEnvelope: {
          protocolVersion: 1,
          eventId: 'evt-err',
          eventType: 'error',
          occurredAt: 1_800_000_054_000,
          body: { category: 'javascript', error: { message: 'x' } },
        },
      }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an unknown performance metric', () => {
    expect(
      parsePersistPerformanceEventSampleInput({
        projectId: '11111111-1111-1111-1111-111111111111',
        eventEnvelope: performanceEnvelope('evt-fcp', { metricName: 'fcp' }),
      }),
    ).toMatchObject({ status: 'invalid_input' });
  });
});
