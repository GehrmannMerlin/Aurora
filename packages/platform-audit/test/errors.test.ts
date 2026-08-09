import { describe, expect, it } from 'vitest';
import {
  isConstraintViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  PlatformAuditError,
  toStableError,
} from '../src/errors.js';

describe('platform-audit error surface', () => {
  it('PlatformAuditError carries a stable kind', () => {
    const error = new PlatformAuditError('invalid_input', 'bad cursor');
    expect(error.name).toBe('PlatformAuditError');
    expect(error.kind).toBe('invalid_input');
    expect(error.message).toBe('bad cursor');
  });

  it('toStableError passes through PlatformAuditError unchanged', () => {
    const original = new PlatformAuditError('invalid_input', 'unknown scope');
    expect(toStableError(original)).toBe(original);
  });

  it('toStableError maps connection errors to database_unavailable', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      const mapped = toStableError(Object.assign(new Error('connect'), { code }));
      expect(mapped.kind).toBe('database_unavailable');
    }
  });

  it('toStableError maps unknown errors to statement_failed', () => {
    const mapped = toStableError(new Error('boom'));
    expect(mapped.kind).toBe('statement_failed');
    expect(mapped.message).toBe('database statement failed');
  });

  it('SQLSTATE classifiers identify pg violation codes', () => {
    const withCode = (code: string): unknown => Object.assign(new Error('pg'), { code });
    expect(isUniqueViolation(withCode('23505'))).toBe(true);
    expect(isUniqueViolation(withCode('23503'))).toBe(false);
    expect(isForeignKeyViolation(withCode('23503'))).toBe(true);
    expect(isConstraintViolation(withCode('23514'))).toBe(true);
    expect(isConstraintViolation(withCode('23502'))).toBe(true);
    expect(isConstraintViolation(withCode('23505'))).toBe(false);
  });
});
