import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  EVENT_SCHEMA_LIMITS,
  EventType,
  parseEventEnvelope,
} from '../src/index.js';

const validInput = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-synthetic-001',
  eventType: EventType.Error,
  occurredAt: 1_800_000_000_000,
  body: {},
} as const;

function issueCodes(input: unknown): readonly string[] {
  const result = parseEventEnvelope(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

describe('parseEventEnvelope', () => {
  it('returns the exact validated envelope for a legal input', () => {
    expect(parseEventEnvelope(validInput)).toEqual({ success: true, data: validInput });
  });

  it.each(['protocolVersion', 'eventId', 'eventType', 'occurredAt', 'body'])(
    'rejects missing required field %s',
    (fieldName) => {
      const input: Record<string, unknown> = { ...validInput };
      Reflect.deleteProperty(input, fieldName);
      expect(issueCodes(input)).toContain('missing_required_field');
    },
  );

  it('rejects a non-object input and an unknown top-level field', () => {
    expect(issueCodes(null)).toContain('invalid_type');
    expect(issueCodes([])).toContain('invalid_type');
    expect(issueCodes({ ...validInput, extra: true })).toContain('unknown_field');
  });

  it('separates type, unsupported-version, invalid-enum, and unknown-event failures', () => {
    expect(issueCodes({ ...validInput, protocolVersion: '1' })).toContain('invalid_type');
    expect(issueCodes({ ...validInput, protocolVersion: 2 })).toContain(
      'unsupported_protocol_version',
    );
    expect(issueCodes({ ...validInput, eventType: 1 })).toContain('invalid_type');
    expect(issueCodes({ ...validInput, eventType: 'Error' })).toContain('invalid_enum');
    expect(issueCodes({ ...validInput, eventType: 'session-replay' })).toContain(
      'unknown_event_type',
    );
  });

  it('enforces event ID type, emptiness, and maximum length', () => {
    expect(issueCodes({ ...validInput, eventId: 1 })).toContain('invalid_type');
    expect(issueCodes({ ...validInput, eventId: '' })).toContain('invalid_type');
    expect(
      issueCodes({ ...validInput, eventId: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength) }),
    ).toEqual([]);
    expect(
      issueCodes({ ...validInput, eventId: 'x'.repeat(EVENT_SCHEMA_LIMITS.maxEventIdLength + 1) }),
    ).toContain('string_too_long');
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid timestamp %s',
    (occurredAt) => {
      expect(issueCodes({ ...validInput, occurredAt })).toContain('invalid_timestamp');
    },
  );

  it('rejects timestamp type errors separately', () => {
    expect(issueCodes({ ...validInput, occurredAt: '1800000000000' })).toContain('invalid_type');
  });

  it('returns body-boundary issues through the public parser without logging or throwing', () => {
    expect(issueCodes({ ...validInput, body: { nested: { password: 'synthetic' } } })).toContain(
      'forbidden_field',
    );
    expect(
      issueCodes({ ...validInput, body: ['x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength + 1)] }),
    ).toContain('string_too_long');
  });

  it('caps public diagnostics without exposing input values', () => {
    const result = parseEventEnvelope({
      ...validInput,
      extra: 'synthetic-secret-value',
      body: Array.from({ length: EVENT_SCHEMA_LIMITS.maxIssues }, () => undefined),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toHaveLength(EVENT_SCHEMA_LIMITS.maxIssues);
      expect(JSON.stringify(result.issues)).not.toContain('synthetic-secret-value');
    }
  });
});
