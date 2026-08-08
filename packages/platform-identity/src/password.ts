import argon2 from 'argon2';

/**
 * Argon2id password hashing (accepted ADR-030).
 *
 * - Unique random salt per call (argon2 default, CSPRNG-backed).
 * - Parameters per OWASP 2026 recommendation / repo benchmark defaults:
 *   memoryCost 19,456 KiB (~19 MiB), timeCost 2, parallelism 1.
 * - The encoded hash embeds salt + parameters; it is safe to store as-is.
 * - Never log the password or the resulting hash.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

/**
 * Verify a password against an Argon2id encoded hash.
 *
 * Failure paths are uniform: any invalid hash, malformed value or runtime
 * error resolves to `false` — it never throws. Argon2's verify compares
 * digests in constant time internally.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
