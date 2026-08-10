import type { Pool } from 'pg';
import { PerformanceMetricName, PerformanceMetricUnit } from '@aurora/event-schema';
import { ProcessingStoreError } from './errors.js';
import type {
  MetricAggregate,
  PerformanceMetricQueryWindow,
  PerformanceMetricSummary,
} from './performance-metric-query-types.js';

const METRIC_NAMES: ReadonlySet<string> = new Set(Object.values(PerformanceMetricName));
const METRIC_UNITS: ReadonlySet<string> = new Set(Object.values(PerformanceMetricUnit));

/** Reject values outside the public PerformanceMetricName enum. */
export function knownMetricName(value: string): PerformanceMetricName {
  if (!METRIC_NAMES.has(value)) {
    throw new ProcessingStoreError('invalid_input', 'unexpected performance metric name in store');
  }
  return value as PerformanceMetricName;
}

/** Reject values outside the public PerformanceMetricUnit enum. */
export function knownUnit(value: string): PerformanceMetricUnit {
  if (!METRIC_UNITS.has(value)) {
    throw new ProcessingStoreError('invalid_input', 'unexpected performance metric unit in store');
  }
  return value as PerformanceMetricUnit;
}

/** numeric / bigint columns arrive from pg as strings; normalize to JS numbers. */
function asNumber(value: string): number {
  return Number(value);
}

/**
 * Mean of a metric aggregate: `value_sum / observed_count`. A zero-observed
 * aggregate is never returned by the query, but the guard keeps the result
 * finite and deterministic if such a row is ever read.
 */
export function metricMean(observedCount: number, valueSum: number): number {
  return observedCount === 0 ? 0 : valueSum / observedCount;
}

/**
 * Windowed project-level performance metric summary. Buckets are complete (no
 * sampling extrapolation): `observedCount`/`valueSum` are summed across the
 * queried buckets, `valueMax` is the maximum per-bucket max, and `mean` is
 * `valueSum / observedCount`. `dataThrough` is the latest bucket `updated_at`
 * as an RFC 3339 UTC timestamp, or null when the window contains no buckets.
 * Rows with `observed_count === 0` are never returned. Unknown metric/unit
 * values map to a stable invalid_input error; database failures map to
 * ProcessingStoreError and never leak internal details.
 */
export async function queryPerformanceMetricSummary(
  pool: Pool,
  input: PerformanceMetricQueryWindow,
): Promise<PerformanceMetricSummary> {
  try {
    const rows = await pool.query<{
      metric_name: string;
      unit: string;
      observed: string;
      sum: string;
      max: string;
    }>(
      `SELECT metric_name, unit,
              SUM(observed_count)::bigint AS observed,
              SUM(value_sum) AS sum,
              MAX(value_max) AS max
       FROM performance_metric_buckets
       WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3
       GROUP BY metric_name, unit
       ORDER BY metric_name, unit`,
      [input.projectId, input.startIso, input.endIso],
    );

    const metrics: MetricAggregate[] = [];
    for (const row of rows.rows) {
      const metricName = knownMetricName(row.metric_name);
      const unit = knownUnit(row.unit);
      const observedCount = asNumber(row.observed);
      // Zero-observed aggregates are not returned (see spec §5.3).
      if (observedCount === 0) continue;
      const valueSum = asNumber(row.sum);
      metrics.push({
        metricName,
        unit,
        observedCount,
        valueSum,
        valueMax: asNumber(row.max),
        mean: metricMean(observedCount, valueSum),
      });
    }

    const dataThroughRow = await pool.query<{ d: Date | null }>(
      `SELECT MAX(updated_at) AS d
       FROM performance_metric_buckets
       WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3`,
      [input.projectId, input.startIso, input.endIso],
    );
    const latest = dataThroughRow.rows[0]?.d ?? null;
    const dataThrough = latest === null ? null : latest.toISOString();

    return { metrics, dataThrough };
  } catch (error) {
    if (error instanceof ProcessingStoreError) throw error;
    throw new ProcessingStoreError('statement_failed', 'performance metric summary query failed');
  }
}
