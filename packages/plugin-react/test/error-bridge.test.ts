import { describe, expect, it } from 'vitest';
import { buildReactErrorDraft } from '../src/react-error-bridge.js';

describe('buildReactErrorDraft', () => {
  it('converts an Error value into a javascript error body', () => {
    const result = buildReactErrorDraft(new Error('boom'));
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('boom');
      expect(result.body.error.name).toBe('Error');
    }
  });

  it('rejects null and non-object values as no_error', () => {
    expect(buildReactErrorDraft(null).ok).toBe(false);
    expect(buildReactErrorDraft(undefined).ok).toBe(false);
    expect(buildReactErrorDraft(42).ok).toBe(false);
  });

  it('falls back for a plain string value', () => {
    const result = buildReactErrorDraft('plain string');
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('plain string');
    }
  });

  it('uses a stable fallback message when the error has no message', () => {
    const result = buildReactErrorDraft({ name: 'CustomError' });
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('Unknown React error');
      expect(result.body.error.name).toBe('CustomError');
    }
  });

  it('does not throw on hostile getters and reads only safe fields', () => {
    const hostile: Record<string, unknown> = { name: 'Hostile', message: 'real', stack: 'trace' };
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('trap');
      },
    });
    const result = buildReactErrorDraft(hostile);
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('Unknown React error');
      expect(result.body.error.name).toBe('Hostile');
    }
  });

  it('rejects schema-invalid bodies (over-limit message)', () => {
    const result = buildReactErrorDraft({ message: 'x'.repeat(5000) });
    expect(result.ok).toBe(false);
  });
});
