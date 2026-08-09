import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createIntentToken, normalizeEmail } from '../src/intent-token.js';

describe('createIntentToken', () => {
  it('produces a CSPRNG token of at least 32 bytes', () => {
    const { token } = createIntentToken();
    // 32 raw bytes base64url => 43 chars; allow future growth, require >= 43.
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('digest is the sha256 hex of the token and differs from the token', () => {
    const { token, digest } = createIntentToken();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
    expect(createHash('sha256').update(token).digest('hex')).toBe(digest);
  });

  it('produces unique tokens per call', () => {
    const a = createIntentToken();
    const b = createIntentToken();
    expect(a.token).not.toBe(b.token);
    expect(a.digest).not.toBe(b.digest);
  });
});

describe('normalizeEmail', () => {
  it('lower-cases and trims the canonical email form', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(normalizeEmail('A@B.CO')).toBe('a@b.co');
  });
});
