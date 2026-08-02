import type { Pool } from 'pg';
import { generateClientKeyPair } from './lifecycle-create.js';
import { sha256Digest } from './digest.js';
import { decodeSecretBytes } from './client-key.js';
import type {
  CredentialMetadata,
  RotateIngestionClientCredentialInput,
  RotateIngestionClientCredentialResult,
} from './lifecycle-types.js';

interface LockedCredentialRow {
  id: string;
  project_id: string;
  status: string;
  allow_non_browser: boolean;
  expires_at: string | null;
}

/**
 * Rotate a client credential in a single transaction: lock the old credential
 * with SELECT ... FOR UPDATE, create a new active credential that inherits the
 * old policy and expiry, and immediately revoke the old one. The new complete
 * key is returned only after COMMIT succeeds.
 */
export async function rotateIngestionClientCredential(
  pool: Pool,
  input: RotateIngestionClientCredentialInput,
): Promise<RotateIngestionClientCredentialResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<LockedCredentialRow>(
      `SELECT id, project_id, status, allow_non_browser, expires_at
       FROM ingestion_client_credentials
       WHERE key_id = $1
       FOR UPDATE`,
      [input.keyId],
    );
    const old = locked.rows[0];
    if (old === undefined) {
      await client.query('ROLLBACK');
      return { status: 'not_found' };
    }
    if (old.status === 'revoked') {
      await client.query('ROLLBACK');
      return { status: 'invalid_state' };
    }
    if (old.expires_at !== null) {
      const expired = await client.query<{ expired: boolean }>(
        `SELECT (expires_at <= now()) AS expired FROM ingestion_client_credentials WHERE id = $1`,
        [old.id],
      );
      if (expired.rows[0]?.expired === true) {
        await client.query('ROLLBACK');
        return { status: 'expired' };
      }
    }

    // Read the old policy.
    const originsResult = await client.query<{ origin: string }>(
      `SELECT origin FROM ingestion_client_credential_origins WHERE credential_id = $1`,
      [old.id],
    );
    const environmentsResult = await client.query<{ environment: string }>(
      `SELECT environment FROM ingestion_client_credential_environments WHERE credential_id = $1`,
      [old.id],
    );

    // Generate a new key pair.
    const { keyId, secret, clientKey } = generateClientKeyPair();
    const secretBytes = decodeSecretBytes(secret);
    if (secretBytes === null) {
      await client.query('ROLLBACK');
      return { status: 'generation_failed' };
    }
    const digest = sha256Digest(secretBytes);

    // Create the new active credential inheriting the old policy and expiry.
    const insert = await client.query<{ id: string }>(
      `INSERT INTO ingestion_client_credentials
         (project_id, key_id, secret_digest, status, allow_non_browser, expires_at)
       VALUES ($1, $2, $3, 'active', $4, $5)
       RETURNING id`,
      [old.project_id, keyId, digest, old.allow_non_browser, old.expires_at],
    );
    const newId = insert.rows[0]?.id;
    if (newId === undefined) {
      await client.query('ROLLBACK');
      return { status: 'generation_failed' };
    }
    for (const row of originsResult.rows) {
      await client.query(
        `INSERT INTO ingestion_client_credential_origins (credential_id, origin)
         VALUES ($1, $2)`,
        [newId, row.origin],
      );
    }
    for (const row of environmentsResult.rows) {
      await client.query(
        `INSERT INTO ingestion_client_credential_environments (credential_id, environment)
         VALUES ($1, $2)`,
        [newId, row.environment],
      );
    }

    // Revoke the old credential in the same transaction.
    await client.query(
      `UPDATE ingestion_client_credentials SET status = 'revoked', updated_at = now()
       WHERE id = $1`,
      [old.id],
    );

    await client.query('COMMIT');

    const newRow = await client.query<{
      id: string;
      project_id: string;
      key_id: string;
      status: string;
      allow_non_browser: boolean;
      expires_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, project_id, key_id, status, allow_non_browser, expires_at, created_at, updated_at
       FROM ingestion_client_credentials WHERE id = $1`,
      [newId],
    );
    const metadata: CredentialMetadata = {
      credentialId: newRow.rows[0]?.id ?? newId,
      projectId: newRow.rows[0]?.project_id ?? old.project_id,
      keyId,
      status: 'active',
      allowNonBrowser: newRow.rows[0]?.allow_non_browser ?? old.allow_non_browser,
      expiresAt: newRow.rows[0]?.expires_at ?? old.expires_at,
      createdAt: newRow.rows[0]?.created_at ?? '',
      updatedAt: newRow.rows[0]?.updated_at ?? '',
    };
    return { status: 'success', metadata, clientKey };
  } catch (error) {
    void error;
    await client.query('ROLLBACK').catch(() => undefined);
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
