import { describe, expect, it } from 'vitest';
import { ProcessingStoreError } from '../src/errors.js';

describe('ProcessingStoreError', () => {
  it('carries a stable kind and name', () => {
    const error = new ProcessingStoreError('invalid_input', 'test message');
    expect(error.kind).toBe('invalid_input');
    expect(error.name).toBe('ProcessingStoreError');
    expect(error.message).toBe('test message');
    expect(error).toBeInstanceOf(Error);
  });

  it('supports every stable kind', () => {
    for (const kind of ['invalid_input', 'database_unavailable', 'statement_failed'] as const) {
      const error = new ProcessingStoreError(kind, 'test');
      expect(error.kind).toBe(kind);
    }
  });
});
