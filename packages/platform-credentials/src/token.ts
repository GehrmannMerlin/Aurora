import { createHash, randomBytes } from 'node:crypto';

/**
 * B6 private management token format (spec §7, ADR-030):
 * `aurora_pt_<tokenId>_<secret>` — a one-time plaintext delivered to the caller
 * exactly once at create time. The server persists only the SHA-256 digest
 * (`private_tokens.token_digest`), never the plaintext.
 */
export const PRIVATE_TOKEN_PREFIX = 'aurora_pt_' as const;

/**
 * Fixed public scope allowlist (spec §7). A token may only request scopes from
 * this frozen set; the service layer is responsible for the final
 * "can the caller grant this scope" authorization check.
 */
export const PRIVATE_TOKEN_SCOPES = Object.freeze([
  'source_maps.upload',
  'releases.write',
] as const);

export type PrivateTokenScope = (typeof PRIVATE_TOKEN_SCOPES)[number];

export type PrivateTokenStatus = 'active' | 'expired' | 'revoked';

export interface TokenStatusInput {
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

/** True when the value is one of the allowlisted scopes. */
export function isPrivateTokenScope(value: string): value is PrivateTokenScope {
  return (PRIVATE_TOKEN_SCOPES as readonly string[]).includes(value);
}

/**
 * Verify every requested scope is allowlisted. An empty array is rejected: a
 * management token that grants nothing is a footgun, so the repository treats
 * `[]` as invalid input.
 */
export function verifyTokenScope(scopes: readonly string[]): boolean {
  return scopes.length > 0 && scopes.every(isPrivateTokenScope);
}

/**
 * Generate the one-time plaintext (`aurora_pt_<tokenId>_<secret>`) plus its
 * SHA-256 hex digest. The secret is 32 bytes from node:crypto CSPRNG, base64url
 * encoded (43 chars). Only the digest is persisted; the plaintext is returned
 * once to the caller and never stored or re-displayed.
 */
export function createPrivateTokenValue(tokenId: string): {
  tokenPlaintext: string;
  digest: string;
} {
  const secret = randomBytes(32).toString('base64url');
  const tokenPlaintext = `${PRIVATE_TOKEN_PREFIX}${tokenId}_${secret}`;
  const digest = createHash('sha256').update(tokenPlaintext).digest('hex');
  return { tokenPlaintext, digest };
}

/** True when a token's expiry has elapsed (or is null = never expires). */
export function isExpired(input: TokenStatusInput, now: Date = new Date()): boolean {
  if (input.expiresAt === null) return false;
  return new Date(input.expiresAt).getTime() <= now.getTime();
}

/**
 * Terminal-status projection of a token. Revocation is irreversible and takes
 * precedence over expiry: a revoked token stays `revoked` even after its
 * expires_at elapses. A token whose expires_at has elapsed is `expired`
 * (treated as invalid). Otherwise `active`.
 */
export function getTokenStatus(
  input: TokenStatusInput,
  now: Date = new Date(),
): PrivateTokenStatus {
  if (input.revokedAt !== null) return 'revoked';
  if (isExpired(input, now)) return 'expired';
  return 'active';
}
