import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { KEY_ID_BYTES, SECRET_BYTES, decodeSecretBytes } from './client-key.js';
import { sha256Digest } from './digest.js';
import { normalizeOrigin } from './origin.js';
import { MAX_ENVIRONMENT_LENGTH, MAX_ORIGIN_LENGTH } from './verification.js';
import type {
  CreateIngestionClientCredentialInput,
  CreateIngestionClientCredentialResult,
  CredentialMetadata,
} from './lifecycle-types.js';

/** Bounded retry constant for keyId uniqueness collisions. */
export const MAX_KEY_ID_ATTEMPTS = 5;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return Buffer.from(binary, 'latin1')
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Generate a new 16-byte keyId + 32-byte secret pair (unpadded base64url). */
export function generateClientKeyPair(): {
  keyId: string;
  secret: string;
  clientKey: string;
} {
  const keyId = toBase64Url(randomBytes(KEY_ID_BYTES));
  const secret = toBase64Url(randomBytes(SECRET_BYTES));
  return { keyId, secret, clientKey: `aurora_ingest_${keyId}_${secret}` };
}

interface CreateValidation {
  ok: boolean;
  projectId?: string;
  origins?: string[];
  environments?: string[];
  allowNonBrowser?: boolean;
  expiresAt?: Date | null;
}

function validateCreateInput(input: CreateIngestionClientCredentialInput): CreateValidation {
  if (typeof input.projectId !== 'string' || !UUID_PATTERN.test(input.projectId)) {
    return { ok: false };
  }
  if (typeof input.allowNonBrowser !== 'boolean') {
    return { ok: false };
  }
  if (input.expiresAt !== null && !(input.expiresAt instanceof Date)) {
    return { ok: false };
  }

  const origins = [...new Set(input.origins)];
  if (origins.length > 100) return { ok: false };
  const normalizedOrigins: string[] = [];
  for (const origin of origins) {
    const normalized = normalizeOrigin(origin);
    if (normalized === null || normalized.length > MAX_ORIGIN_LENGTH) return { ok: false };
    normalizedOrigins.push(normalized);
  }

  const environments = [...new Set(input.environments)];
  if (environments.length > 100) return { ok: false };
  for (const environment of environments) {
    if (environment === '' || environment.length > MAX_ENVIRONMENT_LENGTH) return { ok: false };
  }

  return {
    ok: true,
    projectId: input.projectId,
    origins: normalizedOrigins,
    environments,
    allowNonBrowser: input.allowNonBrowser,
    expiresAt: input.expiresAt,
  };
}

interface InsertedRow {
  id: string;
  project_id: string;
  key_id: string;
  status: string;
  allow_non_browser: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Insert one credential plus its origins/environments inside the given client's transaction. */
async function insertCredentialTransaction(
  client: PoolClient,
  projectId: string,
  keyId: string,
  secret: string,
  allowNonBrowser: boolean,
  expiresAt: Date | null,
  origins: string[],
  environments: string[],
): Promise<InsertedRow> {
  const secretBytes = decodeSecretBytes(secret);
  if (secretBytes === null) {
    throw new Error('generated secret must decode to 32 bytes');
  }
  const digest = sha256Digest(secretBytes);
  const insert = await client.query<InsertedRow>(
    `INSERT INTO ingestion_client_credentials
       (project_id, key_id, secret_digest, status, allow_non_browser, expires_at)
     VALUES ($1, $2, $3, 'active', $4, $5)
     RETURNING id, project_id, key_id, status, allow_non_browser, expires_at, created_at, updated_at`,
    [projectId, keyId, digest, allowNonBrowser, expiresAt],
  );
  const row = insert.rows[0];
  if (row === undefined) {
    throw new Error('credential insert returned no row');
  }
  for (const origin of origins) {
    await client.query(
      `INSERT INTO ingestion_client_credential_origins (credential_id, origin)
       VALUES ($1, $2)`,
      [row.id, origin],
    );
  }
  for (const environment of environments) {
    await client.query(
      `INSERT INTO ingestion_client_credential_environments (credential_id, environment)
       VALUES ($1, $2)`,
      [row.id, environment],
    );
  }
  return row;
}

function rowToMetadata(row: InsertedRow): CredentialMetadata {
  return {
    credentialId: row.id,
    projectId: row.project_id,
    keyId: row.key_id,
    status: row.status as 'active',
    allowNonBrowser: row.allow_non_browser,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Create a new client credential in a single transaction. The complete client
 * key is returned only after COMMIT succeeds. keyId uniqueness collisions are
 * retried with a small bounded loop; other errors are not blindly retried.
 */
export async function createIngestionClientCredential(
  pool: Pool | PoolClient,
  input: CreateIngestionClientCredentialInput,
): Promise<CreateIngestionClientCredentialResult> {
  const validated = validateCreateInput(input);
  if (!validated.ok) {
    return { status: 'invalid_input' };
  }

  for (let attempt = 0; attempt < MAX_KEY_ID_ATTEMPTS; attempt += 1) {
    const { keyId, secret, clientKey } = generateClientKeyPair();
    let client: PoolClient;
    try {
      client = (await pool.connect()) as PoolClient;
    } catch (error) {
      void error;
      return { status: 'temporarily_unavailable' };
    }
    try {
      await client.query('BEGIN');
      let row: InsertedRow;
      try {
        row = await insertCredentialTransaction(
          client,
          validated.projectId ?? '',
          keyId,
          secret,
          validated.allowNonBrowser ?? false,
          validated.expiresAt ?? null,
          validated.origins ?? [],
          validated.environments ?? [],
        );
      } catch (error) {
        const pgError = error as { code?: string; constraint?: string };
        const isKeyIdCollision =
          pgError.code === '23505' && pgError.constraint === 'ingestion_client_credentials_key_id_key';
        await client.query('ROLLBACK').catch(() => undefined);
        if (isKeyIdCollision) {
          // Retry with a fresh keyId; continue the bounded loop.
          throw error;
        }
        return { status: 'temporarily_unavailable' };
      }
      await client.query('COMMIT');
      return { status: 'success', metadata: rowToMetadata(row), clientKey };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const pgError = error as { code?: string; constraint?: string };
      const isKeyIdCollision =
        pgError.code === '23505' &&
        pgError.constraint === 'ingestion_client_credentials_key_id_key';
      if (isKeyIdCollision) {
        continue; // bounded retry on keyId collision only
      }
      return { status: 'temporarily_unavailable' };
    } finally {
      client.release();
    }
  }
  return { status: 'generation_failed' };
}
