import { describe, expect, it } from 'vitest';
import { buildVueErrorDraft } from '../src/vue-error-bridge.js';

describe('buildVueErrorDraft', () => {
  it('converts an Error value into a javascript error body', () => {
    const result = buildVueErrorDraft(new Error('boom'));
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('boom');
      expect(result.body.error.name).toBe('Error');
    }
  });

  it('rejects null and non-object values as no_error', () => {
    expect(buildVueErrorDraft(null).ok).toBe(false);
    expect(buildVueErrorDraft(undefined).ok).toBe(false);
    expect(buildVueErrorDraft(42).ok).toBe(false);
  });

  it('falls back for a plain string value', () => {
    const result = buildVueErrorDraft('plain string');
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('plain string');
    }
  });

  it('uses a stable fallback message when the error has no message', () => {
    const result = buildVueErrorDraft({ name: 'CustomError' });
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('Unknown Vue error');
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
    const result = buildVueErrorDraft(hostile);
    expect(result.ok).toBe(true);
    if (result.ok && result.body.category === 'javascript') {
      expect(result.body.error.message).toBe('Unknown Vue error');
      expect(result.body.error.name).toBe('Hostile');
    }
  });

  it('does not leak rejected schema values to the caller', () => {
    // A body that violates the protocol (e.g. absurdly long message) is rejected.
    const result = buildVueErrorDraft({ message: 'x'.repeat(5000) });
    expect(result.ok).toBe(false);
  });
});
