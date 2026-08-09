import { describe, expect, it } from 'vitest';
import { createIntentToken, maskEmail, normalizeEmail } from '../src/intent-token.js';

describe('intent-token local helpers', () => {
  it('createIntentToken returns a 43-char base64url token and its hex digest', () => {
    const { token, digest } = createIntentToken();
    expect(token).toHaveLength(43);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
  });

  it('normalizeEmail lower-cases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });

  it('maskEmail redacts the local part but keeps the domain', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@example.com');
    expect(maskEmail('no-at-sign')).toBe('***');
  });
});
