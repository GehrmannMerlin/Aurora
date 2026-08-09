import { describe, expect, it } from 'vitest';
import {
  generateClientKeySecret,
  randomPublicIdentifier,
  sha256Digest,
} from '../src/repositories/client-keys.js';

describe('client key generation helpers', () => {
  it('generates a random 32-byte base64url secret', () => {
    const a = generateClientKeySecret();
    const b = generateClientKeySecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url = 43 chars, no padding
  });

  it('produces a stable hex SHA-256 digest of the secret', () => {
    const secret = 'hello-secret';
    const digest = sha256Digest(secret);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Digest(secret)).toBe(digest);
    expect(sha256Digest('other')).not.toBe(digest);
  });

  it('builds public identifiers with the aurora_key_ prefix and base64url(8)', () => {
    const id = randomPublicIdentifier();
    expect(id.startsWith('aurora_key_')).toBe(true);
    expect(id.slice('aurora_key_'.length)).toMatch(/^[A-Za-z0-9_-]{11}$/); // base64url(8) = 11 chars
    expect(randomPublicIdentifier()).not.toBe(id);
  });
});
