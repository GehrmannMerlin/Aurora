import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password hashing (Argon2id)', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('s3cure-Passw0rd!');
    expect(hash).not.toContain('s3cure-Passw0rd!');
    await expect(verifyPassword('s3cure-Passw0rd!', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('produces unique salts (different hashes per call)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('encodes an Argon2id encoded hash with the expected parameters', async () => {
    const hash = await hashPassword('parameter-check');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('any', 'not-a-valid-argon2-hash')).resolves.toBe(false);
    await expect(verifyPassword('any', '')).resolves.toBe(false);
  });
});
