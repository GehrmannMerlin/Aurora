import { describe, expect, it } from 'vitest';
import { createCsrfSecret, verifyCsrf } from '../src/csrf.js';

describe('csrf secrets', () => {
  it('round-trips a created secret', () => {
    const secret = createCsrfSecret();
    expect(verifyCsrf(secret, secret)).toBe(true);
  });

  it('rejects a different token', () => {
    const secret = createCsrfSecret();
    const other = createCsrfSecret();
    expect(secret).not.toBe(other);
    expect(verifyCsrf(secret, other)).toBe(false);
  });

  it('rejects a length-mismatched token without throwing', () => {
    const secret = createCsrfSecret();
    expect(verifyCsrf(secret, secret.slice(0, 16))).toBe(false);
    expect(verifyCsrf(secret, '')).toBe(false);
    expect(verifyCsrf(secret, `${secret}x`)).toBe(false);
  });

  it('produces 32-byte base64url secrets', () => {
    const secret = createCsrfSecret();
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
