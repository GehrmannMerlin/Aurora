import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Generate a fresh 32-byte CSRF secret (base64url) bound to a session. */
export function createCsrfSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time verification of a submitted CSRF token against the session's
 * secret (accepted ADR-030 决定细节 5 / ADR-028 决定细节 5). Length mismatch
 * short-circuits before `timingSafeEqual` (which requires equal-length buffers).
 */
export function verifyCsrf(secret: string, token: string): boolean {
  const expected = Buffer.from(secret, 'utf8');
  const received = Buffer.from(token, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
