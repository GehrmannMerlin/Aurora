import { createHash, timingSafeEqual } from 'node:crypto';

export const DIGEST_BYTES = 32;

/** Fixed 32-byte dummy digest used when a keyId is not found. */
export const DUMMY_DIGEST: Buffer = Buffer.alloc(DIGEST_BYTES);

/** Compute the SHA-256 digest of the decoded secret bytes. */
export function sha256Digest(secretBytes: Uint8Array): Buffer {
  return createHash('sha256').update(secretBytes).digest();
}

/** Constant-time comparison of two digests; length mismatch returns false. */
export function timingSafeDigestEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
