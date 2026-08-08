import type { Pool, PoolClient } from 'pg';
import { parseRequestMetricContributionInput } from './request-metric-contribution.js';
import type { PersistRequestMetricContributionResult } from './request-metric-types.js';

const INSERT_APPLICATION_SQL = `
  INSERT INTO request_metric_event_applications (project_id, event_id)
  VALUES ($1, $2)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING project_id
`;

const UPSERT_BUCKET_SQL = `
  INSERT INTO request_metric_buckets
    (project_id, bucket_start, method, outcome, status_code,
     observed_count, failure_count, slow_count, duration_sum_ms, duration_max_ms)
  VALUES
    ($1, $2, $3, $4, $5, 1,
     CASE WHEN $6 THEN 1 ELSE 0 END,
     CASE WHEN $7 THEN 1 ELSE 0 END,
     $8, $8)
  ON CONFLICT (project_id, bucket_start, method, outcome, status_code)
  DO UPDATE SET
    observed_count = request_metric_buckets.observed_count + 1,
    failure_count = request_metric_buckets.failure_count + (CASE WHEN $6 THEN 1 ELSE 0 END),
    slow_count = request_metric_buckets.slow_count + (CASE WHEN $7 THEN 1 ELSE 0 END),
    duration_sum_ms = request_metric_buckets.duration_sum_ms + $8,
    duration_max_ms = GREATEST(request_metric_buckets.duration_max_ms, $8),
    updated_at = now()
  RETURNING id
`;

/**
 * Persist one request metric contribution within a single committed transaction:
 * register the (project_id, event_id) application first; if it was already
 * applied (duplicate), skip the bucket update; otherwise upsert the UTC-minute
 * metric bucket. Any failure rolls back the whole transaction, so a partially
 * registered application never survives without its bucket contribution. Never
 * exposes the pg Result object or internal database error details.
 */
export async function persistRequestMetricContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestMetricContributionResult> {
  const parsed = parseRequestMetricContributionInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const application = await client.query<{ project_id: string }>(INSERT_APPLICATION_SQL, [
      parsed.projectId,
      parsed.eventId,
    ]);
    if (application.rows.length === 0) {
      // Duplicate: this event was already applied; do not update the bucket.
      await client.query('COMMIT');
      return { status: 'duplicate' };
    }
    await client.query(UPSERT_BUCKET_SQL, [
      parsed.projectId,
      parsed.bucketStartIso,
      parsed.method,
      parsed.outcome,
      parsed.statusCode,
      parsed.isFailure,
      parsed.isSlow,
      parsed.durationMs,
    ]);
    await client.query('COMMIT');
    return { status: 'applied' };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // Never leak database error details to the caller.
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
