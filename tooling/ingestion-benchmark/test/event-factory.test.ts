import { describe, expect, it } from 'vitest';
import {
  parseEventEnvelope,
  parseErrorEventBody,
  parseRequestEventBody,
  parsePerformanceEventBody,
  EventType,
} from '@aurora/event-schema';
import { benchmarkEventFor } from '../src/event-factory.js';

describe('event-factory', () => {
  it('produces envelopes that pass the public parsers', () => {
    for (let i = 0; i < 6; i += 1) {
      const event = benchmarkEventFor(
        'run-00000000-0000-4000-8000-000000000001',
        i,
        1_800_000_000_000,
      );
      const parsed = parseEventEnvelope(event);
      expect(parsed.success).toBe(true);
    }
  });

  it('produces deterministic event categories for the same index', () => {
    const runId = 'run-00000000-0000-4000-8000-000000000001';
    const first = benchmarkEventFor(runId, 0, 1_800_000_000_000);
    const second = benchmarkEventFor(runId, 0, 1_800_000_000_000);
    expect(first).toEqual(second);
  });

  it('cycles error/request/performance evenly', () => {
    const runId = 'run-00000000-0000-4000-8000-000000000001';
    const kinds = [0, 1, 2, 3, 4, 5].map(
      (i) => benchmarkEventFor(runId, i, 1_800_000_000_000).eventType,
    );
    expect(kinds).toEqual([
      EventType.Error,
      EventType.Request,
      EventType.Performance,
      EventType.Error,
      EventType.Request,
      EventType.Performance,
    ]);
  });

  it('produces monotonic event ids', () => {
    const runId = 'run-00000000-0000-4000-8000-000000000001';
    const a = benchmarkEventFor(runId, 1, 1_800_000_000_000);
    const b = benchmarkEventFor(runId, 2, 1_800_000_000_000);
    expect(a.eventId).not.toBe(b.eventId);
    expect(b.eventId.endsWith('-00000002')).toBe(true);
  });

  it('bodies are minimal legal values accepted by body parsers', () => {
    const runId = 'run-00000000-0000-4000-8000-000000000001';
    const error = benchmarkEventFor(runId, 0, 1_800_000_000_000);
    expect(parseErrorEventBody(error.body).success).toBe(true);
    const request = benchmarkEventFor(runId, 1, 1_800_000_000_000);
    expect(parseRequestEventBody(request.body).success).toBe(true);
    const performance = benchmarkEventFor(runId, 2, 1_800_000_000_000);
    expect(parsePerformanceEventBody(performance.body).success).toBe(true);
  });
});
