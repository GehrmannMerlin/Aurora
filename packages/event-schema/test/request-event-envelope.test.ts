import { parseEventEnvelope } from '../src/index.js';
import { parseRequestEventEnvelope } from '../src/request-event-envelope.js';
import { describe, expect, it } from 'vitest';

function requestEnvelope(body: unknown, eventType = 'request'): Record<string, unknown> {
  return {
    protocolVersion: 1,
    eventId: 'evt-request-test-synthetic',
    eventType,
    occurredAt: 1_800_000_005_100,
    body,
  };
}

describe('request event envelope parsing', () => {
  it('accepts a current-version request envelope', () => {
    expect(
      parseRequestEventEnvelope(
        requestEnvelope({
          method: 'GET',
          url: 'https://api.example.test/orders',
          startedAt: 1_800_000_005_000,
          durationMs: 120,
          outcome: 'success',
          statusCode: 200,
        }),
      ),
    ).toEqual({
      success: true,
      data: {
        protocolVersion: 1,
        eventId: 'evt-request-test-synthetic',
        eventType: 'request',
        occurredAt: 1_800_000_005_100,
        body: {
          method: 'GET',
          url: 'https://api.example.test/orders',
          startedAt: 1_800_000_005_000,
          durationMs: 120,
          outcome: 'success',
          statusCode: 200,
        },
      },
    });
  });

  it('rejects a request body under the error event type', () => {
    const result = parseRequestEventEnvelope(requestEnvelope({ method: 'GET' }, 'error'));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('event_type_mismatch');
    }
  });

  it('rejects an unsupported protocol version through the shared envelope parser', () => {
    const result = parseRequestEventEnvelope({
      ...requestEnvelope({
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1,
        durationMs: 1,
        outcome: 'success',
      }),
      protocolVersion: 2,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    }
  });

  it('keeps generic envelope issues unchanged when the body is wrong', () => {
    const input = requestEnvelope({
      method: 'GET',
      url: 'https://api.example.test/orders?token=private',
      startedAt: 1,
      durationMs: -5,
      outcome: 'success',
    });
    const requestResult = parseRequestEventEnvelope(input);
    const genericResult = parseEventEnvelope(input);
    expect(requestResult.success).toBe(false);
    expect(genericResult.success).toBe(true);
    if (!requestResult.success) {
      expect(requestResult.issues.map(({ code }) => code)).toContain('invalid_number');
    }
  });
});
