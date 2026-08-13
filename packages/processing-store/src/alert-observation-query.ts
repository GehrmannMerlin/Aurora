import type { Pool } from 'pg';
import type { AlertObservation, AlertRuleConfig } from './alert-evaluator-types.js';

/** Performance proportion metrics whose ratio needs per-event sample data (ADR-021 deferred). */
const PERFORMANCE_RATIO_METRICS = ['lcp_ratio', 'inp_ratio', 'cls_ratio'] as const;

const LAST_EVIDENCE_SQL = `
  SELECT GREATEST(
    (SELECT max(occurred_at) FROM error_event_occurrences WHERE project_id = $1),
    (SELECT max(last_seen_at) FROM issues WHERE project_id = $1),
    (SELECT max(bucket_start) FROM request_metric_buckets WHERE project_id = $1),
    (SELECT max(bucket_start) FROM performance_metric_buckets WHERE project_id = $1)
  ) AS last_evidence
`;

/**
 * Latest processed-evidence timestamp across the processing tables for a
 * project, or null when the project has never produced evidence. Used to
 * distinguish "no errors occurred" (count 0 → normal) from "no recent data to
 * judge" (→ `no_data_in_window` pause, PRD §11.2.10).
 */
async function lastEvidenceAt(pool: Pool, projectId: string): Promise<number | null> {
  const result = await pool.query<{ last_evidence: Date | null }>(LAST_EVIDENCE_SQL, [projectId]);
  const value = result.rows[0]?.last_evidence;
  return value === null || value === undefined ? null : value.getTime();
}

const COUNT_ERRORS_SQL = `
  SELECT count(*)::bigint AS n FROM error_event_occurrences
  WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
`;

const COUNT_NEW_ISSUES_SQL = `
  SELECT count(*)::bigint AS n FROM issues
  WHERE project_id = $1 AND first_seen_at >= $2 AND first_seen_at <= $3
`;

const COUNT_REAPPEARED_SQL = `
  SELECT count(*)::bigint AS n FROM issue_activities
  WHERE project_id = $1 AND activity_type = 'reappeared' AND created_at >= $2 AND created_at <= $3
`;

const REQUEST_METRICS_SQL = `
  SELECT coalesce(sum(failure_count),0)::bigint AS failures,
         coalesce(sum(observed_count),0)::bigint AS observed,
         coalesce(sum(slow_count),0)::bigint AS slow
  FROM request_metric_buckets
  WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start <= $3
`;

/**
 * Compute the trustworthy metric observation for one rule evaluation window
 * from real processing data (no sampling extrapolation, no invented values).
 *
 * - Performance proportion metrics are honestly `missing` (their ratio needs
 *   per-event sample data that ADR-021 deferred).
 * - A window with no recent processed evidence is `missing` (`no_data_in_window`)
 *   — never treated as zero/normal.
 * - Count metrics use the actual count (0 = genuinely no occurrences).
 */
export async function computeAlertObservation(
  pool: Pool,
  input: { readonly projectId: string; readonly rule: AlertRuleConfig; readonly now: number },
): Promise<AlertObservation> {
  const { projectId, rule, now } = input;
  const windowStart = now - rule.windowMinutes * 60_000;
  const windowEnd = now;

  if ((PERFORMANCE_RATIO_METRICS as readonly string[]).includes(rule.metric)) {
    return {
      kind: 'missing',
      pauseReason: 'performance_ratio_metric_requires_event_samples',
      windowStart,
      windowEnd,
    };
  }

  const lastEvidence = await lastEvidenceAt(pool, projectId);
  if (lastEvidence === null || lastEvidence < windowStart) {
    return { kind: 'missing', pauseReason: 'no_data_in_window', windowStart, windowEnd };
  }

  const startIso = new Date(windowStart).toISOString();
  const endIso = new Date(windowEnd).toISOString();

  if (rule.metric === 'error_count') {
    const result = await pool.query<{ n: string }>(COUNT_ERRORS_SQL, [projectId, startIso, endIso]);
    const n = Number(result.rows[0]?.n ?? 0);
    return { kind: 'data', value: n, sampleCount: n, windowStart, windowEnd, watermark: now };
  }
  if (rule.metric === 'new_issue_count') {
    const result = await pool.query<{ n: string }>(COUNT_NEW_ISSUES_SQL, [
      projectId,
      startIso,
      endIso,
    ]);
    const n = Number(result.rows[0]?.n ?? 0);
    return { kind: 'data', value: n, sampleCount: n, windowStart, windowEnd, watermark: now };
  }
  if (rule.metric === 'issue_reappearance_count') {
    const result = await pool.query<{ n: string }>(COUNT_REAPPEARED_SQL, [
      projectId,
      startIso,
      endIso,
    ]);
    const n = Number(result.rows[0]?.n ?? 0);
    return { kind: 'data', value: n, sampleCount: n, windowStart, windowEnd, watermark: now };
  }

  const metrics = await pool.query<{ failures: string; observed: string; slow: string }>(
    REQUEST_METRICS_SQL,
    [projectId, startIso, endIso],
  );
  const row = metrics.rows[0];
  const failures = Number(row?.failures ?? 0);
  const observed = Number(row?.observed ?? 0);
  const slow = Number(row?.slow ?? 0);
  if (rule.metric === 'request_failure_rate') {
    const value = observed > 0 ? (failures / observed) * 100 : 0;
    return {
      kind: 'data',
      value,
      numerator: failures,
      denominator: observed,
      sampleCount: observed,
      windowStart,
      windowEnd,
      watermark: now,
    };
  }
  return {
    kind: 'data',
    value: slow,
    sampleCount: observed,
    windowStart,
    windowEnd,
    watermark: now,
  };
}
