import { describe, expect, it } from 'vitest';
import { parsePersistRequestEventSampleInput } from '../src/request-sample-input.js';
import type { RequestSampleDbParams } from '../src/request-sample-types.js';

const requestEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-request-1',
  eventType: 'request',
  occurredAt: 1_800_000_005_000,
  body: {
    method: 'GET',
    url: 'https://api.example.test/orders?token=private#frag',
    startedAt: 1_800_000_004_000,
    durationMs: 120,
    outcome: 'success',
    statusCode: 200,
  },
};

const requestBodyNormalized = {
  method: 'GET',
  url: 'https://api.example.test/orders',
  startedAt: 1_800_000_004_000,
  durationMs: 120,
  outcome: 'success',
  statusCode: 200,
};

const errorEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-error-1',
  eventType: 'error',
  occurredAt: 1_800_000_005_000,
  body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
};

describe('parsePersistRequestEventSampleInput', () => {
  it('rejects a non-object top-level input', () => {
    for (const input of [null, 'text', 42, [], undefined]) {
      expect(parsePersistRequestEventSampleInput(input)).toEqual({
        status: 'invalid_input',
        code: 'invalid_top_level',
      });
    }
  });

  it('rejects missing or invalid projectId', () => {
    expect(parsePersistRequestEventSampleInput({ eventEnvelope: requestEnvelope })).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
    expect(
      parsePersistRequestEventSampleInput({ projectId: 42, eventEnvelope: requestEnvelope }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_project_id' });
  });

  it('rejects a missing envelope', () => {
    expect(parsePersistRequestEventSampleInput({ projectId: 'p' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
  });

  it('rejects a non-request event envelope', () => {
    for (const envelope of [errorEnvelope]) {
      expect(
        parsePersistRequestEventSampleInput({ projectId: 'p', eventEnvelope: envelope }),
      ).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
    }
  });

  it('rejects an unsupported protocol version', () => {
    const bad = { ...requestEnvelope, protocolVersion: 2 };
    expect(
      parsePersistRequestEventSampleInput({ projectId: 'p', eventEnvelope: bad }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
  });

  it('rejects an invalid request body (data: URL)', () => {
    const bad = {
      ...requestEnvelope,
      eventId: 'evt-request-bad-url',
      body: { method: 'GET', url: 'data:text/plain,synthetic', startedAt: 1_800_000_004_000, durationMs: 120, outcome: 'success' },
    };
    expect(
      parsePersistRequestEventSampleInput({ projectId: 'p', eventEnvelope: bad }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
  });

  it('accepts a valid request event and maps the safe projection', () => {
    const result = parsePersistRequestEventSampleInput({ projectId: 'p', eventEnvelope: requestEnvelope });
    expect('status' in result).toBe(false);
    if ('status' in result) return;
    const expected: RequestSampleDbParams = {
      projectId: 'p',
      eventId: 'evt-request-1',
      protocolVersion: 1,
      occurredAtIso: new Date(1_800_000_005_000).toISOString(),
      // Protocol strips query and fragment; the stored body is the parsed result.
      sampleBody: requestBodyNormalized,
    };
    expect(result).toEqual(expected);
  });

  it('does not mutate the input objects', () => {
    const input = { projectId: 'p-immutable', eventEnvelope: requestEnvelope };
    const snapshot = structuredClone(input);
    parsePersistRequestEventSampleInput(input);
    expect(input).toEqual(snapshot);
  });
});
