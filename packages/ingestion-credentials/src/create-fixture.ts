import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { decodeSecretBytes } from './client-key.js';
import { sha256Digest } from './digest.js';

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = Buffer.from(binary, 'latin1').toString('base64');
  return base64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomBase64Url(bytes: number): string {
  const buf = randomBytes(bytes);
  return toBase64Url(buf);
}

/** TEST-ONLY: generate a structurally valid client key. Never exported from the package root. */
export function generateFixtureClientKey(): {
  clientKey: string;
  keyId: string;
  secret: string;
} {
  const keyId = randomBase64Url(16);
  const secret = randomBase64Url(32);
  return { clientKey: `aurora_ingest_${keyId}_${secret}`, keyId, secret };
}

export interface InsertCredentialFixtureOptions {
  readonly projectId: string;
  readonly keyId: string;
  readonly secret: string;
  readonly status?: 'active' | 'disabled' | 'revoked';
  readonly allowNonBrowser?: boolean;
  readonly expiresAt?: Date | null;
  readonly origins?: string[];
  readonly environments?: string[];
}

/** TEST-ONLY: insert a credential with its digest and policy rows. */
export async function insertCredentialFixture(
  pool: Pool,
  options: InsertCredentialFixtureOptions,
): Promise<void> {
  const secretBytes = decodeSecretBytes(options.secret);
  if (secretBytes === null) {
    throw new Error('fixture secret must be a valid 32-byte base64url value');
  }
  const digest = sha256Digest(secretBytes);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO ingestion_client_credentials
       (project_id, key_id, secret_digest, status, allow_non_browser, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      options.projectId,
      options.keyId,
      digest,
      options.status ?? 'active',
      options.allowNonBrowser ?? false,
      options.expiresAt === undefined ? null : options.expiresAt,
    ],
  );
  const credentialId = result.rows[0]?.id ?? '';
  for (const origin of options.origins ?? []) {
    await pool.query(
      `INSERT INTO ingestion_client_credential_origins (credential_id, origin)
       VALUES ($1, $2)`,
      [credentialId, origin],
    );
  }
  for (const environment of options.environments ?? []) {
    await pool.query(
      `INSERT INTO ingestion_client_credential_environments (credential_id, environment)
       VALUES ($1, $2)`,
      [credentialId, environment],
    );
  }
}

export { BASE64URL_ALPHABET };
