import type { Pool, PoolClient } from 'pg';
import { decodeSecretBytes, parseIngestionClientKey } from './client-key.js';
import { DUMMY_DIGEST, sha256Digest, timingSafeDigestEqual } from './digest.js';
import { normalizeOrigin } from './origin.js';
import type {
  IngestionCredentialVerificationResult,
  VerifyIngestionCredentialInput,
} from './verification-types.js';

/** Implementation upper bound for environment identifier length (not a product promise). */
export const MAX_ENVIRONMENT_LENGTH = 128;

/** Implementation upper bound for normalized origin length (not a product promise). */
export const MAX_ORIGIN_LENGTH = 256;

interface CredentialRow {
  project_id: string;
  secret_digest: Buffer;
  status: string;
  allow_non_browser: boolean;
  expires_at: string | null;
}

/**
 * Verify a client reporting credential against the durable credential store,
 * following a fixed order: parse -> environment -> origin -> query -> digest
 * -> constant-time compare -> status -> expires_at -> environment policy ->
 * origin/allow_non_browser -> authorized.
 */
export async function verifyIngestionCredential(
  pool: Pool | PoolClient,
  input: VerifyIngestionCredentialInput,
): Promise<IngestionCredentialVerificationResult> {
  // 1. Strictly parse the client key.
  const parsed = parseIngestionClientKey(input.clientKey);
  if (parsed === null) {
    return { status: 'unauthenticated' };
  }

  // 2. Validate the environment input.
  if (
    input.environment === '' ||
    input.environment.length > MAX_ENVIRONMENT_LENGTH
  ) {
    return { status: 'unauthenticated' };
  }

  // 3. Normalize the origin or confirm it is absent.
  const origin: string | null =
    input.origin === null ? null : normalizeOrigin(input.origin);
  if (input.origin !== null && origin === null) {
    return { status: 'origin_forbidden' };
  }
  if (origin !== null && origin.length > MAX_ORIGIN_LENGTH) {
    return { status: 'origin_forbidden' };
  }

  // 4. Query the credential by keyId (parameterized).
  let row: CredentialRow | undefined;
  let credentialId: string | undefined;
  try {
    const result = await pool.query<CredentialRow & { id: string }>(
      `SELECT id, project_id, secret_digest, status, allow_non_browser, expires_at
       FROM ingestion_client_credentials
       WHERE key_id = $1`,
      [parsed.keyId],
    );
    const found = result.rows[0];
    row = found;
    credentialId = found?.id;
  } catch (error) {
    void error;
    return { status: 'temporarily_unavailable' };
  }

  // 5-6. Compute candidate digest from the decoded secret bytes and compare.
  const secretBytes = decodeSecretBytes(parsed.secret);
  if (secretBytes === null) {
    return { status: 'unauthenticated' };
  }
  const candidate = sha256Digest(secretBytes);
  if (row === undefined) {
    // Dummy comparison keeps the not-found path timing-consistent.
    timingSafeDigestEqual(candidate, DUMMY_DIGEST);
    return { status: 'unauthenticated' };
  }
  if (!timingSafeDigestEqual(candidate, row.secret_digest)) {
    return { status: 'unauthenticated' };
  }

  // 7. Check status.
  if (row.status !== 'active') {
    return { status: 'unauthenticated' };
  }

  // 8. Check expiry against database time.
  if (row.expires_at !== null) {
    try {
      const expired = await pool.query<{ expired: boolean }>(
        `SELECT (expires_at <= now()) AS expired FROM ingestion_client_credentials WHERE id = $1`,
        [credentialId],
      );
      if (expired.rows[0]?.expired === true) {
        return { status: 'unauthenticated' };
      }
    } catch (error) {
      void error;
      return { status: 'temporarily_unavailable' };
    }
  }

  // 9. Validate environment against the credential's allowed set.
  try {
    const envResult = await pool.query<{ environment: string }>(
      `SELECT environment FROM ingestion_client_credential_environments
       WHERE credential_id = $1`,
      [credentialId],
    );
    const allowedEnvironments = envResult.rows.map((r) => r.environment);
    if (allowedEnvironments.length > 0 && !allowedEnvironments.includes(input.environment)) {
      return { status: 'environment_forbidden' };
    }
  } catch (error) {
    void error;
    return { status: 'temporarily_unavailable' };
  }

  // 10. Validate origin (or allow_non_browser when origin is absent).
  try {
    const originResult = await pool.query<{ origin: string }>(
      `SELECT origin FROM ingestion_client_credential_origins
       WHERE credential_id = $1`,
      [credentialId],
    );
    const allowedOrigins = originResult.rows.map((r) => r.origin);
    if (origin === null) {
      if (!row.allow_non_browser) {
        return { status: 'origin_forbidden' };
      }
    } else if (!allowedOrigins.includes(origin)) {
      return { status: 'origin_forbidden' };
    }
  } catch (error) {
    void error;
    return { status: 'temporarily_unavailable' };
  }

  // 11. Authorized.
  return { status: 'authorized', projectId: row.project_id, allowedOrigin: origin };
}
