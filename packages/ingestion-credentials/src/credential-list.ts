import type { Pool } from 'pg';
import { IngestionCredentialsError } from './errors.js';
import type { CredentialMetadata } from './lifecycle-types.js';

/**
 * C14 read-only per-project client-key metadata list. Never returns the digest
 * or the secret — only the stable metadata (`credentialId`, `keyId`, status,
 * policy snapshot, timestamps). The full client key is delivered exactly once on
 * create/rotate and is never recoverable afterwards.
 */

export interface ListIngestionClientCredentialsInput {
  readonly projectId: string;
}

export type ListedClientCredential = CredentialMetadata & {
  readonly origins: readonly string[];
  readonly environments: readonly string[];
};

interface CredentialRowShape {
  id: string;
  project_id: string;
  key_id: string;
  status: string;
  allow_non_browser: boolean;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toStableError(error: unknown): IngestionCredentialsError {
  if (error instanceof IngestionCredentialsError) return error;
  const code = (() => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const value = (error as { code?: unknown }).code;
      return typeof value === 'string' ? value : '';
    }
    return '';
  })();
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new IngestionCredentialsError('database_unavailable', 'database is unavailable');
  }
  return new IngestionCredentialsError('statement_failed', 'database statement failed');
}

const CREDENTIAL_COLUMNS = `
  id, project_id, key_id, status, allow_non_browser, expires_at, created_at, updated_at
`;

/** List per-project client-key metadata (no digest, no secret). */
export async function listIngestionClientCredentials(
  pool: Pool,
  input: ListIngestionClientCredentialsInput,
): Promise<ListedClientCredential[]> {
  try {
    const credentials = await pool.query<CredentialRowShape>(
      `SELECT ${CREDENTIAL_COLUMNS}
       FROM ingestion_client_credentials
       WHERE project_id = $1
       ORDER BY created_at DESC, id ASC`,
      [input.projectId],
    );

    const ids = credentials.rows.map((row) => row.id);
    const origins = new Map<string, string[]>();
    const environments = new Map<string, string[]>();
    if (ids.length > 0) {
      const originResult = await pool.query<{ credential_id: string; origin: string }>(
        `SELECT credential_id, origin FROM ingestion_client_credential_origins
         WHERE credential_id = ANY($1::uuid[])
         ORDER BY origin ASC`,
        [ids],
      );
      for (const row of originResult.rows) {
        const current = origins.get(row.credential_id) ?? [];
        current.push(row.origin);
        origins.set(row.credential_id, current);
      }
      const envResult = await pool.query<{ credential_id: string; environment: string }>(
        `SELECT credential_id, environment FROM ingestion_client_credential_environments
         WHERE credential_id = ANY($1::uuid[])
         ORDER BY environment ASC`,
        [ids],
      );
      for (const row of envResult.rows) {
        const current = environments.get(row.credential_id) ?? [];
        current.push(row.environment);
        environments.set(row.credential_id, current);
      }
    }

    return credentials.rows.map((row) => ({
      credentialId: row.id,
      projectId: row.project_id,
      keyId: row.key_id,
      status: row.status as CredentialMetadata['status'],
      allowNonBrowser: row.allow_non_browser,
      expiresAt: row.expires_at === null ? null : row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      origins: origins.get(row.id) ?? [],
      environments: environments.get(row.id) ?? [],
    }));
  } catch (error) {
    throw toStableError(error);
  }
}
