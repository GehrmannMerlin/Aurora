import { describe, expect, it } from 'vitest';
import {
  ERROR_EVENT_LIMITS,
  EVENT_SCHEMA_LIMITS,
  ErrorCategory,
  PromiseRejectionReasonKind,
  parseErrorEventBody,
  type EventSchemaIssueCode,
} from '@aurora/event-schema';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const result = parseErrorEventBody(input);
  return result.success ? [] : result.issues.map(({ code }) => code);
}

function nestedValue(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

describe('unhandled Promise rejection body', () => {
  it('accepts Error-style and string-style reasons', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.Error,
          error: { name: 'Error', message: 'Synthetic rejection', stack: 'at app.js:1:1' },
        },
      }).success,
    ).toBe(true);
    expect(
      parseErrorEventBody({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'Synthetic rejection',
        },
      }).success,
    ).toBe(true);
  });

  it.each([null, true, 42, ['synthetic', 1], { code: 7, tags: ['synthetic'] }])(
    'accepts and recursively copies bounded non-standard value %#',
    (value) => {
      const input = {
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: PromiseRejectionReasonKind.NonStandard, value },
      };
      const result = parseErrorEventBody(input);
      expect(result.success).toBe(true);
      if (result.success && result.data.category === ErrorCategory.UnhandledRejection) {
        expect(result.data).not.toBe(input);
        expect(result.data.reason).not.toBe(input.reason);
        if (
          result.data.reason.kind === PromiseRejectionReasonKind.NonStandard &&
          typeof value === 'object' &&
          value !== null
        ) {
          expect(result.data.reason.value).not.toBe(value);
        }
      }
    },
  );

  it('does not retain nested caller arrays or objects', () => {
    const value = { tags: ['synthetic'] };
    const input = {
      category: ErrorCategory.UnhandledRejection,
      reason: { kind: PromiseRejectionReasonKind.NonStandard, value },
    };
    const result = parseErrorEventBody(input);
    expect(result.success).toBe(true);
    value.tags.push('changed-after-parse');
    if (
      result.success &&
      result.data.category === ErrorCategory.UnhandledRejection &&
      result.data.reason.kind === PromiseRejectionReasonKind.NonStandard
    ) {
      expect(result.data.reason.value).toEqual({ tags: ['synthetic'] });
    }
  });

  it('rejects missing, empty, non-canonical, and unknown reasons', () => {
    expect(issueCodes({ category: ErrorCategory.UnhandledRejection })).toContain(
      'missing_required_field',
    );
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: PromiseRejectionReasonKind.String, value: '' },
      }),
    ).toContain('string_empty');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: PromiseRejectionReasonKind.NonStandard, value: 'synthetic' },
      }),
    ).toContain('invalid_type');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: { kind: 'unknown', value: null },
      }),
    ).toContain('invalid_enum');
  });

  it('enforces rejection-string boundary', () => {
    expect(
      parseErrorEventBody({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength),
        },
      }).success,
    ).toBe(true);
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'r'.repeat(ERROR_EVENT_LIMITS.maxRejectionStringLength + 1),
        },
      }),
    ).toContain('string_too_long');
  });

  it('rejects cyclic, too-deep, too-large, forbidden, and non-JSON values safely', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const base = {
      category: ErrorCategory.UnhandledRejection,
      reason: { kind: PromiseRejectionReasonKind.NonStandard },
    };
    expect(issueCodes({ ...base, reason: { ...base.reason, value: cyclic } })).toContain(
      'cyclic_reference',
    );
    expect(
      issueCodes({
        ...base,
        reason: { ...base.reason, value: nestedValue(EVENT_SCHEMA_LIMITS.maxObjectDepth) },
      }),
    ).toContain('object_too_deep');
    expect(
      issueCodes({
        ...base,
        reason: {
          ...base.reason,
          value: Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null),
        },
      }),
    ).toContain('array_too_large');
    expect(
      issueCodes({
        ...base,
        reason: {
          ...base.reason,
          value: Object.fromEntries(
            Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
              `field${String(index)}`,
              null,
            ]),
          ),
        },
      }),
    ).toContain('object_too_large');
    expect(
      issueCodes({
        ...base,
        reason: { ...base.reason, value: { nested: { authorization: 'synthetic' } } },
      }),
    ).toContain('forbidden_field');
    expect(
      issueCodes({
        ...base,
        reason: { ...base.reason, value: { access_token: 'synthetic' } },
      }),
    ).toContain('forbidden_field');
    for (const value of [undefined, 1n, Symbol('synthetic'), () => undefined, Number.NaN]) {
      expect(issueCodes({ ...base, reason: { ...base.reason, value } })).not.toEqual([]);
    }
  });

  it('rejects unknown fields in the body and reason variants', () => {
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        extra: true,
        reason: { kind: PromiseRejectionReasonKind.String, value: 'Synthetic' },
      }),
    ).toContain('unknown_field');
    expect(
      issueCodes({
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'Synthetic',
          extra: true,
        },
      }),
    ).toContain('unknown_field');
  });
});
