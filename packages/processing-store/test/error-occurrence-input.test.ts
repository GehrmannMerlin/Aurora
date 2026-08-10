import type { ErrorEventBody } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { computeErrorFingerprint } from '../src/error-fingerprint.js';
import { parsePersistErrorEventOccurrenceInput } from '../src/error-occurrence-input.js';
import type { ErrorOccurrenceDbParams } from '../src/error-occurrence-types.js';

const javascriptEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-processing-js-1',
  eventType: 'error',
  occurredAt: 1_800_000_003_001,
  body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
};

const promiseEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-processing-promise-1',
  eventType: 'error',
  occurredAt: 1_800_000_003_002,
  body: {
    category: 'unhandled_rejection',
    reason: { kind: 'string', value: 'Synthetic Promise rejection' },
  },
};

const resourceEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-processing-resource-1',
  eventType: 'error',
  occurredAt: 1_800_000_003_003,
  body: {
    category: 'resource',
    resource: { type: 'script', url: 'https://static.example.test/app.js?cache=1' },
  },
};

describe('parsePersistErrorEventOccurrenceInput', () => {
  it('rejects a non-object top-level input', () => {
    for (const input of [null, 'text', 42, [], undefined]) {
      expect(parsePersistErrorEventOccurrenceInput(input)).toEqual({
        status: 'invalid_input',
        code: 'invalid_top_level',
      });
    }
  });

  it('rejects a missing or unknown top-level field', () => {
    expect(parsePersistErrorEventOccurrenceInput({ projectId: 'p' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
    expect(parsePersistErrorEventOccurrenceInput({ eventEnvelope: {} })).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
  });

  it('rejects a missing or non-string projectId', () => {
    expect(
      parsePersistErrorEventOccurrenceInput({
        eventEnvelope: javascriptEnvelope,
      }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_top_level' });
    expect(
      parsePersistErrorEventOccurrenceInput({ projectId: 42, eventEnvelope: javascriptEnvelope }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_project_id' });
    expect(
      parsePersistErrorEventOccurrenceInput({ projectId: '', eventEnvelope: javascriptEnvelope }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_project_id' });
  });

  it('rejects a missing envelope', () => {
    expect(parsePersistErrorEventOccurrenceInput({ projectId: 'p' })).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
  });

  it('rejects a non-error envelope', () => {
    const requestEnvelope = {
      protocolVersion: 1,
      eventId: 'evt-processing-request-1',
      eventType: 'request',
      occurredAt: 1_800_000_003_004,
      body: {
        method: 'GET',
        url: 'https://api.example.test/items',
        startedAt: 1_800_000_003_000,
        durationMs: 120,
        outcome: 'success',
      },
    };
    expect(
      parsePersistErrorEventOccurrenceInput({ projectId: 'p', eventEnvelope: requestEnvelope }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
  });

  it('rejects an unsupported protocol version', () => {
    const badVersion = { ...javascriptEnvelope, protocolVersion: 2 };
    expect(
      parsePersistErrorEventOccurrenceInput({ projectId: 'p', eventEnvelope: badVersion }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
  });

  it('rejects an invalid error body', () => {
    const badUrl = {
      protocolVersion: 1,
      eventId: 'evt-processing-bad-1',
      eventType: 'error',
      occurredAt: 1_800_000_003_005,
      body: { category: 'resource', resource: { type: 'font', url: 'file:///tmp/font.woff2' } },
    };
    expect(
      parsePersistErrorEventOccurrenceInput({ projectId: 'p', eventEnvelope: badUrl }),
    ).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
  });

  it('accepts all three current error categories and maps fields correctly', () => {
    const cases: {
      input: unknown;
      expected: Omit<ErrorOccurrenceDbParams, 'fingerprint' | 'fingerprintVersion'>;
    }[] = [
      {
        input: javascriptEnvelope,
        expected: {
          projectId: 'p-js',
          eventId: 'evt-processing-js-1',
          protocolVersion: 1,
          occurredAtIso: new Date(1_800_000_003_001).toISOString(),
          errorCategory: 'javascript',
          normalizedBody: javascriptEnvelope.body,
        },
      },
      {
        input: promiseEnvelope,
        expected: {
          projectId: 'p-promise',
          eventId: 'evt-processing-promise-1',
          protocolVersion: 1,
          occurredAtIso: new Date(1_800_000_003_002).toISOString(),
          errorCategory: 'unhandled_rejection',
          normalizedBody: promiseEnvelope.body,
        },
      },
      {
        input: resourceEnvelope,
        expected: {
          projectId: 'p-resource',
          eventId: 'evt-processing-resource-1',
          protocolVersion: 1,
          occurredAtIso: new Date(1_800_000_003_003).toISOString(),
          errorCategory: 'resource',
          // Protocol strips the query parameter; normalized body reflects the
          // parsed result, not the raw input.
          normalizedBody: {
            category: 'resource',
            resource: { type: 'script', url: 'https://static.example.test/app.js' },
          },
        },
      },
    ];
    for (const { input, expected } of cases) {
      const result = parsePersistErrorEventOccurrenceInput({
        projectId: expected.projectId,
        eventEnvelope: input,
      });
      expect('status' in result).toBe(false);
      if ('status' in result) continue;
      expect(result).toMatchObject(expected);
      // DAT-12: the store computes a stable fingerprint from the validated body.
      expect(result.fingerprint).toBe(
        computeErrorFingerprint({
          projectId: expected.projectId,
          body: result.normalizedBody as ErrorEventBody,
        }).fingerprint,
      );
      expect(result.fingerprintVersion).toBe(1);
    }
  });

  it('does not mutate the input objects', () => {
    const input = { projectId: 'p-immutable', eventEnvelope: javascriptEnvelope };
    const snapshot = structuredClone(input);
    parsePersistErrorEventOccurrenceInput(input);
    expect(input).toEqual(snapshot);
  });
});
