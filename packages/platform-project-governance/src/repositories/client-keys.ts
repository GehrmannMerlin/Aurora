import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PlatformProjectGovernanceError, toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { isPoolClient, withTransaction } from './transaction.js';

/** Public client-key identifier prefix: safe to embed in browser code. */
export const CLIENT_KEY_PUBLIC_PREFIX = 'aurora_key_';

/**
 * Generate a fresh 32-byte client-key secret. The secret is NEVER persisted:
 * only its SHA-256 digest (`sha256Digest`) is stored in `client_keys.key_digest`
 * and no repository function in this package ever returns the raw secret after
 * creation (it is used by the SDK, not surfaced through this data layer).
 */
export function generateClientKeySecret(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest of a client-key secret (the only form persisted). */
export function sha256Digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Public identifier `aurora_key_<base64url(8)>`: public, goes in browser code. */
export function randomPublicIdentifier(): string {
  return `${CLIENT_KEY_PUBLIC_PREFIX}${randomBytes(8).toString('base64url')}`;
}

/** camelCase projection of a client_keys row (never the raw secret). */
export interface ClientKeyRow {
  readonly clientKeyId: string;
  readonly projectId: string;
  readonly publicIdentifier: string;
  readonly enabled: boolean;
  readonly allowedOrigins: readonly string[];
  readonly allowedEnvironments: readonly string[];
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RevokeClientKeyInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly clientKeyId: string;
  readonly actorId: string;
}

export type RevokeClientKeyResult =
  | { readonly status: 'success'; readonly clientKeyId: string; readonly projectId: string }
  | { readonly status: 'not_found' };

/**
 * Insert the default client key for a freshly created project. Called on the
 * caller's transaction so `createProject` stays atomic. The secret is generated
 * once here, immediately reduced to its SHA-256 digest, and never persisted or
 * returned; only the public identifier (which goes in browser code) is returned.
 */
export async function createDefaultClientKey(
  client: PoolClient,
  input: { readonly projectId: string },
): Promise<{ readonly clientKeyId: string; readonly publicIdentifier: string }> {
  const secret = generateClientKeySecret();
  const digest = sha256Digest(secret);
  const publicIdentifier = randomPublicIdentifier();
  const inserted = await client.query<{ client_key_id: string }>(
    `INSERT INTO client_keys (project_id, public_identifier, key_digest)
     VALUES ($1, $2, $3)
     RETURNING client_key_id`,
    [input.projectId, publicIdentifier, digest],
  );
  const row = inserted.rows[0];
  if (row === undefined) {
    throw new PlatformProjectGovernanceError(
      'statement_failed',
      'client key insert returned no row',
    );
  }
  return { clientKeyId: row.client_key_id, publicIdentifier };
}

async function runRevokeClientKey(
  client: PoolClient,
  input: RevokeClientKeyInput,
): Promise<RevokeClientKeyResult> {
  const updated = await client.query<{ client_key_id: string; project_id: string }>(
    `UPDATE client_keys ck
     SET enabled = false, updated_at = now()
     FROM projects p
     WHERE ck.client_key_id = $3
       AND ck.project_id = p.project_id
       AND p.organization_id = $1
       AND p.project_id = $2
     RETURNING ck.client_key_id, ck.project_id`,
    [input.orgId, input.projectId, input.clientKeyId],
  );
  const row = updated.rows[0];
  if (row === undefined) return { status: 'not_found' };
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'client_key.revoked',
    details: { clientKeyId: input.clientKeyId, projectId: input.projectId },
  });
  return { status: 'success', clientKeyId: row.client_key_id, projectId: row.project_id };
}

/**
 * Revoke a client key within an organization's project. This is an irreversible
 * disable: this package exposes no re-enable path, and a trash→restore cycle
 * never re-enables keys (see trash.ts). Scoped by org + project so a key from
 * one project cannot be revoked through another. Idempotent: revoking an
 * already-disabled key still succeeds. Transactional.
 */
export async function revokeClientKey(
  pool: Pool | PoolClient,
  input: RevokeClientKeyInput,
): Promise<RevokeClientKeyResult> {
  try {
    return isPoolClient(pool)
      ? await runRevokeClientKey(pool, input)
      : await withTransaction(pool, (client) => runRevokeClientKey(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
