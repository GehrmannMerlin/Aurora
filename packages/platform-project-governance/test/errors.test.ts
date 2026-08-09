import { describe, expect, it } from 'vitest';
import {
  PlatformProjectGovernanceError,
  isConstraintViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  toStableError,
} from '../src/errors.js';

describe('PlatformProjectGovernanceError surface', () => {
  it('exposes the stable error kind', () => {
    const error = new PlatformProjectGovernanceError('invalid_input', 'bad input');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlatformProjectGovernanceError');
    expect(error.kind).toBe('invalid_input');
    expect(error.message).toBe('bad input');
  });

  it('classifies unique/fk/check/not-null SQLSTATE codes', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(isConstraintViolation({ code: '23514' })).toBe(true);
    expect(isConstraintViolation({ code: '23502' })).toBe(true);
    expect(isConstraintViolation({ code: '23505' })).toBe(false);
  });

  it('returns the same error when already stable', () => {
    const stable = new PlatformProjectGovernanceError('invalid_input', 'bad');
    expect(toStableError(stable)).toBe(stable);
  });

  it('maps connection failures to database_unavailable', () => {
    for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      expect(toStableError({ code }).kind).toBe('database_unavailable');
    }
  });

  it('maps unknown errors to statement_failed without leaking messages', () => {
    expect(toStableError(new Error('boom')).kind).toBe('statement_failed');
    expect(toStableError('raw string').kind).toBe('statement_failed');
    expect(toStableError(undefined).kind).toBe('statement_failed');
    expect(toStableError({ code: 123 }).kind).toBe('statement_failed');
  });
});
