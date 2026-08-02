import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  parseErrorEventBody,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventBody(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

describe('JavaScript runtime error body', () => {
  it('accepts the minimum body and returns a fresh object', () => {
    const input = {
      category: ErrorCategory.JavaScript,
      error: { message: 'Synthetic runtime failure' },
    };
    const result = parseErrorEventBody(input);
    expect(result).toEqual({ success: true, data: input });
    expect(parseErrorEventBody(input)).toEqual(result);
    if (result.success && result.data.category === ErrorCategory.JavaScript) {
      expect(result.data).not.toBe(input);
      expect(result.data.error).not.toBe(input.error);
    }
  });

  it('accepts bounded name, message, and raw stack', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.JavaScript,
        error: {
          name: 'TypeError',
          message: 'Synthetic runtime failure',
          stack: 'TypeError: Synthetic runtime failure\n    at app.js:1:1',
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ error: { message: 'Synthetic' } }, 'missing_required_field'],
    [{ category: ErrorCategory.JavaScript }, 'missing_required_field'],
    [{ category: ErrorCategory.JavaScript, error: {} }, 'missing_required_field'],
    [{ category: ErrorCategory.JavaScript, error: null }, 'invalid_type'],
    [{ category: ErrorCategory.JavaScript, error: { message: null } }, 'invalid_type'],
    [{ category: ErrorCategory.JavaScript, error: { message: '' } }, 'string_empty'],
    [{ category: 'JavaScript', error: { message: 'Synthetic' } }, 'invalid_enum'],
  ] as const)('rejects malformed body %#', (input, code) => {
    expect(issueCodes(input)).toContain(code);
  });

  it('enforces exact string boundaries', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.JavaScript,
        error: {
          name: 'n'.repeat(ERROR_EVENT_LIMITS.maxErrorNameLength),
          message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength),
          stack: 's'.repeat(ERROR_EVENT_LIMITS.maxStackLength),
        },
      }).success,
    ).toBe(true);
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: { message: 'm'.repeat(ERROR_EVENT_LIMITS.maxErrorMessageLength + 1) },
      }),
    ).toContain('string_too_long');
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: {
          name: 'n'.repeat(ERROR_EVENT_LIMITS.maxErrorNameLength + 1),
          message: 'Synthetic',
        },
      }),
    ).toContain('string_too_long');
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: {
          message: 'Synthetic',
          stack: 's'.repeat(ERROR_EVENT_LIMITS.maxStackLength + 1),
        },
      }),
    ).toContain('string_too_long');
  });

  it('rejects unknown fields at both exact object levels', () => {
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        extra: true,
        error: { message: 'Synthetic' },
      }),
    ).toContain('unknown_field');
    expect(
      issueCodes({
        category: ErrorCategory.JavaScript,
        error: { message: 'Synthetic', line: 1 },
      }),
    ).toContain('unknown_field');
  });

  it('returns a fixed issue when a getter throws and does not throw or log', () => {
    const input = Object.defineProperty({}, 'category', {
      enumerable: true,
      get(): never {
        throw new Error('synthetic getter detail');
      },
    });
    expect(() => parseErrorEventBody(input)).not.toThrow();
    const result = parseErrorEventBody(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual([
        {
          code: 'invalid_type',
          path: ['body'],
          message: 'Error event body could not be read safely',
        },
      ]);
      expect(JSON.stringify(result.issues)).not.toContain('synthetic getter detail');
    }
  });
});
