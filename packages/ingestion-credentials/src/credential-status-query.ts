import type { Pool } from 'pg';
import { IngestionCredentialsError } from './errors.js';

/** Safe per-project projection over `ingestion_client_credentials`. */
export interface ProjectCredentialSafeStatus {
  readonly activeCount: number;
  readonly disabledCount: number;
  readonly revokedCount: number;
  readonly latestCreatedAt: string | null;
}

interface StatusCountRow {
  status: string;
  cnt: string;
}

interface LatestRow {
  latest: Date | null;
}

const CREDENTIAL_STATUSES: ReadonlySet<string> = new Set(['active', 'disabled', 'revoked']);

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

const STATUS_COUNTS_SQL = `
  SELECT status, COUNT(*)::bigint AS cnt
  FROM ingestion_client_credentials
  WHERE project_id = $1
  GROUP BY status
`;

const LATEST_SQL = `
  SELECT MAX(created_at) AS latest
  FROM ingestion_client_credentials
  WHERE project_id = $1
`;

/**
 * Read-only safe status counts for one project's client reporting credentials.
 * Only `status` and `created_at` are read — never the digest, keyId, origins, or
 * environments. All SQL is parameterized; database failures are mapped to a
 * stable IngestionCredentialsError and never leak internal details.
 */
export async function queryProjectCredentialSafeStatus(
  pool: Pool,
  input: { projectId: string },
): Promise<ProjectCredentialSafeStatus> {
  try {
    const countsResult = await pool.query<StatusCountRow>(STATUS_COUNTS_SQL, [input.projectId]);
    const latestResult = await pool.query<LatestRow>(LATEST_SQL, [input.projectId]);

    let activeCount = 0;
    let disabledCount = 0;
    let revokedCount = 0;
    for (const row of countsResult.rows) {
      if (!CREDENTIAL_STATUSES.has(row.status)) {
        throw new IngestionCredentialsError('invalid_input', 'unexpected credential status in store');
      }
      if (row.status === 'active') activeCount = Number(row.cnt);
      if (row.status === 'disabled') disabledCount = Number(row.cnt);
      if (row.status === 'revoked') revokedCount = Number(row.cnt);
    }

    const latest = latestResult.rows[0]?.latest ?? null;
    return {
      activeCount,
      disabledCount,
      revokedCount,
      latestCreatedAt: latest === null ? null : latest.toISOString(),
    };
  } catch (error) {
    throw toStableError(error);
  }
}
