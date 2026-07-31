import { describe, expect, it } from 'vitest';
import { EVENT_SCHEMA_LIMITS } from '../src/constants.js';
import type { EventSchemaIssueCode } from '../src/validation-issues.js';
import { validateBodyValue } from '../src/value-boundaries.js';

function issueCodes(input: unknown): readonly EventSchemaIssueCode[] {
  const issues: Parameters<typeof validateBodyValue>[1] = [];
  validateBodyValue(input, issues);
  return issues.map(({ code }) => code);
}

function nestedObject(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

describe('event body resource boundaries', () => {
  it('accepts all JSON primitives and exact maximum boundaries', () => {
    expect(issueCodes(null)).toEqual([]);
    expect(issueCodes(true)).toEqual([]);
    expect(issueCodes(42)).toEqual([]);
    expect(issueCodes('x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength))).toEqual([]);
    expect(
      issueCodes(Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength }, () => null)),
    ).toEqual([]);
    expect(
      issueCodes(
        Object.fromEntries(
          Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys }, (_, index) => [
            `field${String(index)}`,
            null,
          ]),
        ),
      ),
    ).toEqual([]);
    expect(issueCodes(nestedObject(EVENT_SCHEMA_LIMITS.maxObjectDepth))).toEqual([]);
  });

  it('rejects strings, arrays, objects, and nesting one unit over their limits', () => {
    expect(issueCodes('x'.repeat(EVENT_SCHEMA_LIMITS.maxStringLength + 1))).toContain(
      'string_too_long',
    );
    expect(
      issueCodes(Array.from({ length: EVENT_SCHEMA_LIMITS.maxArrayLength + 1 }, () => null)),
    ).toContain('array_too_large');
    expect(
      issueCodes(
        Object.fromEntries(
          Array.from({ length: EVENT_SCHEMA_LIMITS.maxObjectKeys + 1 }, (_, index) => [
            `field${String(index)}`,
            null,
          ]),
        ),
      ),
    ).toContain('object_too_large');
    expect(issueCodes(nestedObject(EVENT_SCHEMA_LIMITS.maxObjectDepth + 1))).toContain(
      'object_too_deep',
    );
  });

  it('rejects non-JSON numbers and values', () => {
    expect(issueCodes(Number.NaN)).toContain('invalid_number');
    expect(issueCodes(Number.POSITIVE_INFINITY)).toContain('invalid_number');
    expect(issueCodes(undefined)).toContain('invalid_type');
    expect(issueCodes(1n)).toContain('invalid_type');
    expect(issueCodes(new Date(0))).toContain('invalid_type');
    expect(issueCodes(new Map())).toContain('invalid_type');
    expect(issueCodes(() => undefined)).toContain('invalid_type');
  });

  it('rejects cyclic values without throwing', () => {
    const input: { self?: unknown } = {};
    input.self = input;
    expect(issueCodes(input)).toContain('cyclic_reference');
  });

  it.each([
    'authorization',
    'Authorization',
    'cookie',
    'password',
    'requestBody',
    'responseBody',
    'formData',
    'dom',
    'consoleLog',
    'ipAddress',
  ])('rejects forbidden field %s at any nesting level', (fieldName) => {
    expect(issueCodes({ safe: { [fieldName]: 'synthetic' } })).toContain('forbidden_field');
  });

  it('caps diagnostics at maxIssues', () => {
    const input = Array.from({ length: EVENT_SCHEMA_LIMITS.maxIssues }, () => undefined);
    expect(issueCodes(input)).toHaveLength(EVENT_SCHEMA_LIMITS.maxIssues);
  });
});
