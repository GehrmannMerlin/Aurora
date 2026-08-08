import { createHash, randomBytes } from 'node:crypto';

/**
 * Create a high-entropy one-time intent token plus its SHA-256 digest.
 *
 * - token: 32 bytes from node:crypto CSPRNG, base64url encoded (43 chars).
 * - digest: hex SHA-256 of the token. Only the digest is persisted in the
 *   authoritative intent tables; the raw token travels in the email link /
 *   HttpOnly intent cookie and is never stored server-side.
 */
export function createIntentToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  return { token, digest };
}

/**
 * Deterministic email canonical form used for `accounts.email_normalized` and
 * the anti-enumeration match key. Lower-cases and trims surrounding
 * whitespace. Domain normalization beyond this is handled upstream if needed.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
