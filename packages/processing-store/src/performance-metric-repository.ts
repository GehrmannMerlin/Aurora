import type { Pool, PoolClient } from 'pg';
import { parsePerformanceMetricContributionInput } from './performance-metric-contribution.js';
import type { PersistPerformanceMetricContributionResult } from './performance-metric-types.js';

const INSERT_APPLICATION_SQL = `
  INSERT INTO performance_metric_event_applications (project_id, event_id)
  VALUES ($1, $2)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING project_id
`;

const UPSERT_BUCKET_SQL = `
  INSERT INTO performance_metric_buckets
    (project_id, bucket_start, metric_name, unit, observed_count, value_sum, value_max)
  VALUES
    ($1, $2, $3, $4, 1, $5, $5)
  ON CONFLICT (project_id, bucket_start, metric_name, unit)
  DO UPDATE SET
    observed_count = performance_metric_buckets.observed_count + 1,
    value_sum = performance_metric_buckets.value_sum + $5,
    value_max = GREATEST(performance_metric_buckets.value_max, $5),
    updated_at = now()
  RETURNING id
`;

/**
 * Persist one performance metric contribution within a single committed
 * transaction: register the (project_id, event_id) application first; if it was
 * already applied (duplicate), skip the bucket update; otherwise upsert the
 * UTC-minute performance bucket. Any failure rolls back the whole transaction.
 * Never exposes the pg Result object or internal database error details.
 */
export async function persistPerformanceMetricContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistPerformanceMetricContributionResult> {
  const parsed = parsePerformanceMetricContributionInput(input);
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
      parsed.metricName,
      parsed.unit,
      parsed.value,
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
