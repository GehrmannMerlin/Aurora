import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PlatformCredentialsError, toStableError } from '../errors.js';
import { createPrivateTokenValue, verifyTokenScope } from '../token.js';
import { insertAuditEvent } from './audit.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

/** camelCase metadata projection of a private_tokens row (NO digest, NO plaintext). */
export interface PrivateTokenRow {
  readonly tokenId: string;
  readonly organizationId: string;
  readonly createdBy: string;
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
}

export interface CreatePrivateTokenInput {
  readonly orgId: string;
  readonly createdBy: string;
  /** Non-sensitive display name; trimmed 1-100 characters. */
  readonly name: string;
  /** Scopes from the fixed public allowlist; non-empty. */
  readonly scopes: readonly string[];
  /** null = never expires. A past expiry is rejected at create time. */
  readonly expiresAt?: Date | null;
}

export interface CreatePrivateTokenResult {
  readonly status: 'success';
  readonly tokenId: string;
  /**
   * One-time delivery: the plaintext appears ONLY in this create response
   * object. It is never persisted (the DB stores only `token_digest`) and is
   * never re-displayed by any read path. cache-prohibited at the HTTP layer.
   */
  readonly tokenPlaintext: string;
  /** SHA-256 hex digest of the full plaintext. Exposed for the caller to reconcile. */
  readonly digest: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string | null;
}

export interface RevokePrivateTokenInput {
  readonly tokenId: string;
  readonly actorId: string;
}

export type RevokePrivateTokenResult =
  { readonly status: 'success' } | { readonly status: 'not_found' };

interface PrivateTokenRowShape {
  token_id: string;
  organization_id: string;
  created_by: string;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

interface NormalizedCreateInput {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
}

function toPrivateTokenRow(row: PrivateTokenRowShape): PrivateTokenRow {
  return {
    tokenId: row.token_id,
    organizationId: row.organization_id,
    createdBy: row.created_by,
    name: row.name,
    scopes: row.scopes,
    expiresAt: isoTimestamp(row.expires_at),
    revokedAt: isoTimestamp(row.revoked_at),
    lastUsedAt: isoTimestamp(row.last_used_at),
    createdAt: isoTimestamp(row.created_at),
  };
}

/** Validate + normalize create input. Throws invalid_input before any DB work. */
function normalizeCreateInput(input: CreatePrivateTokenInput): NormalizedCreateInput {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) {
    throw new PlatformCredentialsError('invalid_input', 'token name must be 1-100 characters');
  }
  if (!verifyTokenScope(input.scopes)) {
    throw new PlatformCredentialsError(
      'invalid_input',
      'token scopes must be non-empty and from the allowlist',
    );
  }
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
    throw new PlatformCredentialsError('invalid_input', 'token expiry must be in the future');
  }
  return { name, scopes: input.scopes, expiresAt };
}

async function runCreatePrivateToken(
  client: PoolClient,
  input: NormalizedCreateInput,
  actor: { readonly orgId: string; readonly createdBy: string },
): Promise<CreatePrivateTokenResult> {
  const tokenId = randomUUID();
  const { tokenPlaintext, digest } = createPrivateTokenValue(tokenId);
  const inserted = await client.query<{ created_at: string }>(
    `INSERT INTO private_tokens
       (token_id, organization_id, created_by, name, token_digest, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING created_at`,
    [
      tokenId,
      actor.orgId,
      actor.createdBy,
      input.name,
      digest,
      JSON.stringify(input.scopes),
      input.expiresAt === null ? null : input.expiresAt.toISOString(),
    ],
  );
  const row = inserted.rows[0];
  if (row === undefined) {
    throw new PlatformCredentialsError('statement_failed', 'token insert returned no row');
  }
  await insertAuditEvent(client, {
    organizationId: actor.orgId,
    actorAccountId: actor.createdBy,
    action: 'credentials.private_token.created',
    // Audit details never contain the plaintext, the digest, or any secret.
    details: { tokenId },
  });
  return {
    status: 'success',
    tokenId,
    tokenPlaintext,
    digest,
    scopes: input.scopes,
    expiresAt: input.expiresAt === null ? null : input.expiresAt.toISOString(),
  };
}

/**
 * Create a private management token atomically with its audit row: metadata +
 * SHA-256 digest + audit in one transaction. The plaintext is generated once,
 * returned to the caller, and never persisted. Unknown or empty scopes and past
 * expiries are rejected as `invalid_input`.
 */
export async function createPrivateToken(
  pool: Pool | PoolClient,
  input: CreatePrivateTokenInput,
): Promise<CreatePrivateTokenResult> {
  const normalized = normalizeCreateInput(input);
  try {
    return isPoolClient(pool)
      ? await runCreatePrivateToken(pool, normalized, input)
      : await withTransaction(pool, (client) => runCreatePrivateToken(client, normalized, input));
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * List an organization's private tokens, metadata only. NEVER returns the
 * digest or the plaintext.
 */
export async function listPrivateTokens(
  pool: Pool | PoolClient,
  orgId: string,
): Promise<PrivateTokenRow[]> {
  try {
    const result = await pool.query<PrivateTokenRowShape>(
      `SELECT token_id, organization_id, created_by, name, scopes, expires_at, revoked_at, last_used_at, created_at
       FROM private_tokens
       WHERE organization_id = $1
       ORDER BY created_at DESC, token_id ASC`,
      [orgId],
    );
    return result.rows.map(toPrivateTokenRow);
  } catch (error) {
    throw toStableError(error);
  }
}

async function runRevokePrivateToken(
  client: PoolClient,
  input: RevokePrivateTokenInput,
): Promise<RevokePrivateTokenResult> {
  const updated = await client.query<{ organization_id: string }>(
    `UPDATE private_tokens
     SET revoked_at = now()
     WHERE token_id = $1 AND revoked_at IS NULL
     RETURNING organization_id`,
    [input.tokenId],
  );
  const row = updated.rows[0];
  if (row === undefined) {
    // Either already revoked or non-existent. Distinguish so re-revoke stays
    // idempotent (success, no duplicate audit) while an unknown token is
    // reported as not_found.
    const exists = await client.query(`SELECT 1 FROM private_tokens WHERE token_id = $1`, [
      input.tokenId,
    ]);
    return exists.rows.length > 0 ? { status: 'success' } : { status: 'not_found' };
  }
  await insertAuditEvent(client, {
    organizationId: row.organization_id,
    actorAccountId: input.actorId,
    action: 'credentials.private_token.revoked',
    details: { tokenId: input.tokenId },
  });
  return { status: 'success' };
}

/**
 * Revoke a private management token. Irreversible: once `revoked_at` is set the
 * token is terminal and is never reactivated. The revoke + audit write share one
 * transaction. Re-revoking an already-revoked token is idempotent (success, no
 * duplicate audit); a genuinely unknown token id returns `not_found`.
 */
export async function revokePrivateToken(
  pool: Pool | PoolClient,
  input: RevokePrivateTokenInput,
): Promise<RevokePrivateTokenResult> {
  try {
    return isPoolClient(pool)
      ? await runRevokePrivateToken(pool, input)
      : await withTransaction(pool, (client) => runRevokePrivateToken(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
