import type { Pool } from 'pg';
import {
  INBOX_DIAGNOSTIC_STATES,
  type InboxDiagnosticState,
  type ProjectInboxDiagnostics,
} from './diagnostics-types.js';
import { IngestionInboxError } from './errors.js';

interface StateCountRow {
  state: string;
  cnt: string;
}

interface LatestRow {
  latest_received: Date | null;
  latest_processed: Date | null;
  latest_dead_lettered: Date | null;
  last_error: string | null;
}

const INBOX_STATE_SET: ReadonlySet<string> = new Set(INBOX_DIAGNOSTIC_STATES);

function toStableError(error: unknown): IngestionInboxError {
  if (error instanceof IngestionInboxError) return error;
  const code = (() => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const value = (error as { code?: unknown }).code;
      return typeof value === 'string' ? value : '';
    }
    return '';
  })();
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new IngestionInboxError('database_unavailable', 'database is unavailable');
  }
  return new IngestionInboxError('statement_failed', 'database statement failed');
}

/**
 * Pure assembly of `GROUP BY state` rows into the full five-state map. A state
 * with no rows keeps a factual zero. Any state outside the known five-value set
 * is a store invariant violation and maps to a stable invalid_input error.
 */
export function accumulateByState(
  rows: readonly { readonly state: string; readonly cnt: string | number }[],
): Record<InboxDiagnosticState, number> {
  const counts: Record<InboxDiagnosticState, number> = {
    pending: 0,
    leased: 0,
    retry_waiting: 0,
    processed: 0,
    dead_lettered: 0,
  };
  for (const row of rows) {
    if (!INBOX_STATE_SET.has(row.state)) {
      throw new IngestionInboxError('invalid_input', 'unexpected event_inbox state in store');
    }
    counts[row.state as InboxDiagnosticState] = Number(row.cnt);
  }
  return counts;
}

function isoOrNull(value: Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toISOString();
}

const STATE_COUNTS_SQL = `
  SELECT state, COUNT(*)::bigint AS cnt
  FROM event_inbox
  WHERE project_id = $1 AND received_at >= $2 AND received_at < $3
  GROUP BY state
`;

const LATEST_SQL = `
  SELECT
    MAX(received_at) AS latest_received,
    MAX(processed_at) AS latest_processed,
    MAX(dead_lettered_at) AS latest_dead_lettered,
    (
      SELECT last_error_code
      FROM event_inbox
      WHERE project_id = $1 AND state = 'dead_lettered'
        AND received_at >= $2 AND received_at < $3
        AND dead_lettered_at IS NOT NULL
      ORDER BY dead_lettered_at DESC
      LIMIT 1
    ) AS last_error
  FROM event_inbox
  WHERE project_id = $1 AND received_at >= $2 AND received_at < $3
`;

/**
 * Read-only per-project inbox diagnostics over the half-open `received_at`
 * window `[startIso, endIso)`. All SQL is parameterized; database failures are
 * mapped to a stable IngestionInboxError and never leak internal details.
 */
export async function queryProjectInboxDiagnostics(
  pool: Pool,
  input: { projectId: string; startIso: string; endIso: string },
): Promise<ProjectInboxDiagnostics> {
  try {
    const countsResult = await pool.query<StateCountRow>(STATE_COUNTS_SQL, [
      input.projectId,
      input.startIso,
      input.endIso,
    ]);
    const latestResult = await pool.query<LatestRow>(LATEST_SQL, [
      input.projectId,
      input.startIso,
      input.endIso,
    ]);
    const latest = latestResult.rows[0];
    return {
      byState: accumulateByState(countsResult.rows),
      latestReceivedAt: isoOrNull(latest?.latest_received),
      latestProcessedAt: isoOrNull(latest?.latest_processed),
      latestDeadLetteredAt: isoOrNull(latest?.latest_dead_lettered),
      lastErrorCode: latest?.last_error ?? null,
    };
  } catch (error) {
    throw toStableError(error);
  }
}
