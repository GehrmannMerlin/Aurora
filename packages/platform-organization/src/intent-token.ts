import { createHash, randomBytes } from 'node:crypto';

/**
 * Create a high-entropy one-time intent token plus its SHA-256 digest.
 *
 * - token: 32 bytes from node:crypto CSPRNG, base64url encoded (43 chars).
 * - digest: hex SHA-256 of the token. Only the digest is persisted in the
 *   authoritative invitation table; the raw token travels in the email link /
 *   outbox payload and is never stored server-side.
 *
 * Local copy of the PLT-03 `createIntentToken` helper: this data-layer package
 * may not depend on `@aurora/platform-identity` (data → {protocol} only), so
 * the small helper is duplicated here.
 */
export function createIntentToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  return { token, digest };
}

/**
 * Deterministic email canonical form used for `organization_invitations.invited_email`
 * and the already-member match key. Lower-cases and trims surrounding whitespace.
 * Local copy of the PLT-03 `normalizeEmail` helper for the same reason as
 * `createIntentToken`.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Mask the local part of an email for audit `details` (full email addresses
 * must never be persisted to `security_audit_events`, per PLT-03 §4.9).
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}
