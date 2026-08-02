import type { Pool } from 'pg';
import type {
  CredentialMetadata,
  MutateIngestionClientCredentialInput,
  MutateIngestionClientCredentialResult,
} from './lifecycle-types.js';

type TransitionKind = 'disable' | 'enable' | 'revoke';

interface MutateRow {
  id: string;
  project_id: string;
  key_id: string;
  status: string;
  allow_non_browser: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Decide the target status for a mutation given the current status and expiry. */
function targetStatus(
  kind: TransitionKind,
  current: string,
  expired: boolean,
): { target?: string; result?: MutateIngestionClientCredentialResult } {
  if (kind === 'disable') {
    if (current === 'revoked') return { result: { status: 'invalid_state' } };
    if (expired) return { result: { status: 'expired' } };
    // active -> disabled, disabled -> disabled (idempotent)
    return { target: 'disabled' };
  }
  if (kind === 'enable') {
    if (current === 'revoked') return { result: { status: 'invalid_state' } };
    if (expired) return { result: { status: 'expired' } };
    // disabled -> active, active -> active (idempotent)
    return { target: 'active' };
  }
  // revoke
  // active/disabled/expired-not-persisted -> revoked; revoked -> revoked (idempotent)
  return { target: 'revoked' };
}

/**
 * Mutate a client credential's lifecycle status in a single transaction.
 * Uses SELECT ... FOR UPDATE to serialize concurrent state changes, and the
 * database clock to determine expiry.
 */
export async function mutateCredentialStatus(
  pool: Pool,
  kind: TransitionKind,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<MutateRow>(
      `SELECT id, project_id, key_id, status, allow_non_browser, expires_at, created_at, updated_at
       FROM ingestion_client_credentials
       WHERE key_id = $1
       FOR UPDATE`,
      [input.keyId],
    );
    const row = locked.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }

    let expired = false;
    if (row.expires_at !== null) {
      const exp = await client.query<{ expired: boolean }>(
        `SELECT (expires_at <= now()) AS expired FROM ingestion_client_credentials WHERE id = $1`,
        [row.id],
      );
      expired = exp.rows[0]?.expired === true;
    }

    const decision = targetStatus(kind, row.status, expired);
    if (decision.result !== undefined) {
      await client.query('ROLLBACK');
      return decision.result;
    }
    const target = decision.target ?? row.status;

    await client.query(
      `UPDATE ingestion_client_credentials SET status = $2, updated_at = now()
       WHERE id = $1`,
      [row.id, target],
    );
    await client.query('COMMIT');

    const metadata: CredentialMetadata = {
      credentialId: row.id,
      projectId: row.project_id,
      keyId: row.key_id,
      status: target as 'active' | 'disabled' | 'revoked',
      allowNonBrowser: row.allow_non_browser,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return { status: 'success', metadata };
  } catch (error) {
    void error;
    await client.query('ROLLBACK').catch(() => undefined);
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}

export async function disableIngestionClientCredential(
  pool: Pool,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult> {
  return mutateCredentialStatus(pool, 'disable', input);
}

export async function enableIngestionClientCredential(
  pool: Pool,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult> {
  return mutateCredentialStatus(pool, 'enable', input);
}

export async function revokeIngestionClientCredential(
  pool: Pool,
  input: MutateIngestionClientCredentialInput,
): Promise<MutateIngestionClientCredentialResult> {
  return mutateCredentialStatus(pool, 'revoke', input);
}
