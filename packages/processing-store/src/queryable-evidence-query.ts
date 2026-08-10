import type { Pool } from 'pg';
import { ProcessingStoreError } from './errors.js';

/** Per-project row-count evidence that queryable stores actually hold data. */
export interface ProjectQueryableEvidence {
  readonly errorOccurrences: number;
  readonly requestMetricBuckets: number;
  readonly performanceMetricBuckets: number;
}

interface EvidenceRow {
  error: string;
  request: string;
  performance: string;
}

const EVIDENCE_SQL = `
  SELECT
    (SELECT COUNT(*)::bigint FROM error_event_occurrences WHERE project_id = $1) AS error,
    (SELECT COUNT(*)::bigint FROM request_metric_buckets WHERE project_id = $1) AS request,
    (SELECT COUNT(*)::bigint FROM performance_metric_buckets WHERE project_id = $1) AS performance
`;

/**
 * Read-only per-project row counts across the three queryable processing stores
 * (`error_event_occurrences`, `request_metric_buckets`, `performance_metric_buckets`).
 * All SQL is parameterized; database failures are mapped to a stable
 * ProcessingStoreError and never leak internal details.
 */
export async function queryProjectQueryableEvidence(
  pool: Pool,
  input: { projectId: string },
): Promise<ProjectQueryableEvidence> {
  try {
    const result = await pool.query<EvidenceRow>(EVIDENCE_SQL, [input.projectId]);
    const row = result.rows[0];
    return {
      errorOccurrences: Number(row?.error ?? '0'),
      requestMetricBuckets: Number(row?.request ?? '0'),
      performanceMetricBuckets: Number(row?.performance ?? '0'),
    };
  } catch (error) {
    if (error instanceof ProcessingStoreError) throw error;
    throw new ProcessingStoreError('statement_failed', 'queryable evidence query failed');
  }
}
