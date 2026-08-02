import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  ErrorCategory,
  ErrorResourceType,
  EventType,
  parseErrorEventEnvelope,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

const validEnvelope = {
  protocolVersion: CURRENT_PROTOCOL_VERSION,
  eventId: 'evt-error-envelope-synthetic',
  eventType: EventType.Error,
  occurredAt: 1_800_000_002_000,
  body: {
    category: ErrorCategory.JavaScript,
    error: { message: 'Synthetic runtime failure' },
  },
} as const;

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventEnvelope(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

describe('parseErrorEventEnvelope', () => {
  it('composes the current envelope and exact body into fresh output', () => {
    const result = parseErrorEventEnvelope(validEnvelope);
    expect(result).toEqual({ success: true, data: validEnvelope });
    expect(parseErrorEventEnvelope(validEnvelope)).toEqual(result);
    if (result.success && result.data.body.category === ErrorCategory.JavaScript) {
      expect(result.data).not.toBe(validEnvelope);
      expect(result.data.body).not.toBe(validEnvelope.body);
      expect(result.data.body.error).not.toBe(validEnvelope.body.error);
    }
  });

  it.each([EventType.Request, EventType.Performance, EventType.Resource])(
    'rejects error body combined with %s',
    (eventType) => {
      expect(issueCodes({ ...validEnvelope, eventType })).toContain('event_type_mismatch');
    },
  );

  it('preserves existing version, timestamp, and envelope-field issues', () => {
    for (const protocolVersion of [0, 2]) {
      expect(issueCodes({ ...validEnvelope, protocolVersion })).toContain(
        'unsupported_protocol_version',
      );
    }
    expect(issueCodes({ ...validEnvelope, occurredAt: 0 })).toContain('invalid_timestamp');
    expect(issueCodes({ ...validEnvelope, extra: true })).toContain('unknown_field');
  });

  it('rejects an invalid exact body after generic envelope success', () => {
    expect(
      issueCodes({
        ...validEnvelope,
        body: { category: ErrorCategory.JavaScript, error: { message: '' } },
      }),
    ).toContain('string_empty');
  });

  it('returns sanitized resource URL and leaves the original unchanged', () => {
    const input = {
      ...validEnvelope,
      eventId: 'evt-resource-envelope-synthetic',
      body: {
        category: ErrorCategory.Resource,
        resource: {
          type: ErrorResourceType.Stylesheet,
          url: 'https://static.example.test/app.css?cache=synthetic#fragment',
        },
      },
    };
    const result = parseErrorEventEnvelope(input);
    expect(result.success).toBe(true);
    if (result.success && result.data.body.category === ErrorCategory.Resource) {
      expect(result.data.body.resource.url).toBe('https://static.example.test/app.css');
      expect(input.body.resource.url).toContain('?cache=synthetic');
    }
  });

  it('returns a fixed issue when generic envelope property access throws', () => {
    const input = Object.defineProperty({}, 'protocolVersion', {
      enumerable: true,
      get(): never {
        throw new Error('synthetic envelope getter');
      },
    });
    const result = parseErrorEventEnvelope(input);
    expect(result).toEqual({
      success: false,
      issues: [
        {
          code: 'invalid_type',
          path: [],
          message: 'Error event envelope could not be read safely',
        },
      ],
    });
  });
});
