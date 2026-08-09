/**
 * @aurora/platform-credentials — Aurora platform private management token data
 * layer (PLT-04 B6).
 *
 * This module is the package root. It exposes:
 * - the B6 token format (`PRIVATE_TOKEN_PREFIX`), the frozen scope allowlist
 *   (`PRIVATE_TOKEN_SCOPES`), scope verification (`verifyTokenScope`) and
 *   expiry/status helpers (`isExpired`/`getTokenStatus`);
 * - repositories over the `private_tokens` table created by this package's
 *   migration:
 *   - `createPrivateToken` — ATOMIC {metadata + SHA-256 digest + audit} in one
 *     transaction; the plaintext `aurora_pt_<tokenId>_<secret>` is generated
 *     once and returned ONLY in the create response object (one-time delivery),
 *     the DB stores only the digest;
 *   - `listPrivateTokens` — metadata only, NEVER the digest or plaintext;
 *   - `revokePrivateToken` — irreversible (terminal `revoked_at`), audited
 *     in-transaction, idempotent re-revoke.
 * - the stable PlatformCredentialsError surface.
 *
 * This is a data-layer package: it depends only on {protocol} workspace
 * packages (none currently) and plain `pg`. It never imports or declares
 * `@aurora/platform-contract` (contract layer) per Workspace Policy
 * (data → {protocol}).
 */
export const PLATFORM_CREDENTIALS_PACKAGE = '@aurora/platform-credentials' as const;

export const PLATFORM_CREDENTIALS_VERSION = '0.0.0' as const;

export { PlatformCredentialsError, type PlatformCredentialsErrorKind } from './errors.js';

export {
  PRIVATE_TOKEN_PREFIX,
  PRIVATE_TOKEN_SCOPES,
  getTokenStatus,
  isExpired,
  isPrivateTokenScope,
  verifyTokenScope,
  type PrivateTokenScope,
  type PrivateTokenStatus,
  type TokenStatusInput,
} from './token.js';

export type {
  CreatePrivateTokenInput,
  CreatePrivateTokenResult,
  PrivateTokenRow,
  RevokePrivateTokenInput,
  RevokePrivateTokenResult,
} from './repositories/private-tokens.js';
export {
  createPrivateToken,
  listPrivateTokens,
  revokePrivateToken,
} from './repositories/private-tokens.js';
