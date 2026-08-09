import { arr, enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId, PrivateTokenId } from '../common/identifiers.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_LIST_PRIVATE_TOKENS = 'credentialsListPrivateTokens' as const;
export const OPERATION_ID_CREATE_PRIVATE_TOKEN = 'credentialsCreatePrivateToken' as const;
export const OPERATION_ID_REVOKE_PRIVATE_TOKEN = 'credentialsRevokePrivateToken' as const;

export const credentialsListPrivateTokensRequest = obj({
  organizationId: OrganizationId,
});

// B6 list: metadata only — the token digest is never exposed and the plaintext no longer exists
// server-side after the one-time create response.
const privateTokenSummary = obj({
  tokenId: PrivateTokenId,
  name: str(1, 128),
  scopes: arr(str(1, 128), 0, 50),
  expiresAt: optional(utcTimestamp),
  revokedAt: optional(utcTimestamp),
  lastUsedAt: optional(utcTimestamp),
});

export const credentialsListPrivateTokensResponse = obj({
  tokens: arr(privateTokenSummary, 0, 100),
  navigationTargets,
});

export const credentialsCreatePrivateTokenPathParams = obj({
  organizationId: OrganizationId,
});

export const credentialsCreatePrivateTokenRequest = obj({
  name: str(1, 128),
  scopes: arr(str(1, 128), 1, 50),
  expiresAt: optional(utcTimestamp),
  idempotencyKey,
});

// One-time plaintext delivery: tokenPlaintext appears ONLY here, in the first successful create
// response (Cache-Control: no-store); it is never stored server-side.
export const credentialsCreatePrivateTokenResponse = obj({
  tokenId: PrivateTokenId,
  tokenPlaintext: str(20, 256),
  scopes: arr(str(1, 128), 0, 50),
  expiresAt: optional(utcTimestamp),
});

export const credentialsRevokePrivateTokenRequest = obj({
  organizationId: OrganizationId,
  tokenId: PrivateTokenId,
});

export const credentialsRevokePrivateTokenResponse = obj({
  status: enum_(['succeeded']),
  tokenId: PrivateTokenId,
});
