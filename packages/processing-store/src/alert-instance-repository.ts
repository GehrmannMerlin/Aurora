import type { Pool, PoolClient } from 'pg';
import type {
  ActiveAlertInstance,
  EvaluateAlertRoundResult,
} from './alert-evaluator-types.js';
import { buildAlertRuleSnapshot, type AlertRuleRow } from './alert-types.js';
import type {
  AlertEvidenceRow,
  AlertInstanceRow,
  AlertInstanceSummary,
  AlertTransitionRow,
} from './alert-types.js';

const ACTIVE_INSTANCE_SQL = `
  SELECT id, state, triggered_at, recovery_since, paused_from
  FROM alert_instances
  WHERE rule_id = $1 AND state <> 'recovered'
  ORDER BY id DESC
  LIMIT 1
`;

/** Active (non-recovered) instance for a rule, including its DB row id. */
export interface ActiveAlertInstanceRow extends ActiveAlertInstance {
  readonly id: string;
}

/**
 * Read the active (non-recovered) instance for a rule, if any. Instances exist
 * only after a full trigger; `pending_trigger` is a rule projection, not an
 * instance.
 */
export async function getActiveAlertInstance(
  pool: Pool | PoolClient,
  input: { readonly ruleId: string },
): Promise<ActiveAlertInstanceRow | null> {
  const result = await pool.query<{
    id: string;
    state: string;
    triggered_at: Date;
    recovery_since: Date | null;
    paused_from: string | null;
  }>(ACTIVE_INSTANCE_SQL, [input.ruleId]);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    state: row.state as ActiveAlertInstance['state'],
    triggeredAt: row.triggered_at.getTime(),
    recoverySince: row.recovery_since === null ? null : row.recovery_since.getTime(),
    pausedFrom: (row.paused_from ?? null) as ActiveAlertInstance['pausedFrom'],
  };
}

const UPDATE_RULE_EVALUATION_SQL = `
  UPDATE alert_rules SET
    evaluation_state = $2,
    evaluation_since = $3,
    last_evaluated_at = $4,
    evaluation_pause_reason = $5,
    last_observed_value = $6,
    last_notified_at = COALESCE($7, last_notified_at),
    updated_at = now()
  WHERE id = $1
`;

const INSERT_INSTANCE_SQL = `
  INSERT INTO alert_instances (rule_id, project_id, state, triggered_at, rule_snapshot)
  VALUES ($1, $2, 'triggered', $3, $4::jsonb)
  RETURNING id
`;

const UPDATE_INSTANCE_SQL = `
  UPDATE alert_instances SET
    state = $2, recovery_since = $3, recovered_at = $4, paused_from = $5,
    pause_reason = $6, updated_at = now()
  WHERE rule_id = $1 AND state <> 'recovered'
`;

const UPSERT_EVIDENCE_SQL = `
  INSERT INTO alert_instance_evidence
    (instance_id, evaluated_at, state_after, window_start_at, window_end_at,
     observed_value, numerator, denominator, sample_count, min_sample_requirement,
     watermark_at, completeness, pause_reason, applied_filters)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
  ON CONFLICT (instance_id) DO UPDATE SET
    evaluated_at = EXCLUDED.evaluated_at, state_after = EXCLUDED.state_after,
    window_start_at = EXCLUDED.window_start_at, window_end_at = EXCLUDED.window_end_at,
    observed_value = EXCLUDED.observed_value, numerator = EXCLUDED.numerator,
    denominator = EXCLUDED.denominator, sample_count = EXCLUDED.sample_count,
    min_sample_requirement = EXCLUDED.min_sample_requirement,
    watermark_at = EXCLUDED.watermark_at, completeness = EXCLUDED.completeness,
    pause_reason = EXCLUDED.pause_reason, applied_filters = EXCLUDED.applied_filters
`;

const INSERT_TRANSITION_SQL = `
  INSERT INTO alert_instance_transitions (instance_id, from_state, to_state, reason, occurred_at)
  VALUES ($1, $2, $3, $4, $5)
`;

function evidenceParams(instanceId: string, result: EvaluateAlertRoundResult): unknown[] {
  const e = result.evidence;
  return [
    instanceId,
    new Date(e.evaluatedAt).toISOString(),
    result.ruleEval.state,
    new Date(e.windowStart).toISOString(),
    new Date(e.windowEnd).toISOString(),
    e.observedValue,
    e.numerator,
    e.denominator,
    e.sampleCount,
    e.minSampleRequirement,
    e.watermark === null ? null : new Date(e.watermark).toISOString(),
    e.completeness,
    e.pauseReason,
    JSON.stringify(e.appliedFilters),
  ];
}

/**
 * Persist one evaluation round atomically: update the rule evaluation
 * projection, then apply the instance action (create / update / recover) with
 * its evidence and transition. `recovered` is terminal; the active-instance
 * partial unique index prevents a second active instance per rule.
 */
export async function persistAlertEvaluation(
  pool: Pool,
  input: { readonly rule: AlertRuleRow; readonly result: EvaluateAlertRoundResult },
): Promise<void> {
  const { rule, result } = input;
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(UPDATE_RULE_EVALUATION_SQL, [
      rule.id,
      result.ruleEval.state,
      result.ruleEval.since === null ? null : new Date(result.ruleEval.since).toISOString(),
      new Date(result.ruleEval.lastEvaluatedAt).toISOString(),
      result.ruleEval.pauseReason,
      result.evidence.observedValue,
      result.notifyNow ? new Date(result.nextLastNotifiedAt).toISOString() : null,
    ]);

    const action = result.instanceAction;
    if (action.action === 'create') {
      const created = await client.query<{ id: string }>(INSERT_INSTANCE_SQL, [
        rule.id,
        rule.projectId,
        new Date(action.triggeredAt).toISOString(),
        JSON.stringify(buildAlertRuleSnapshot(rule)),
      ]);
      const instanceId = created.rows[0]?.id ?? '';
      if (instanceId !== '') {
        await client.query(UPSERT_EVIDENCE_SQL, evidenceParams(instanceId, result));
        if (result.transition !== null) {
          await client.query(INSERT_TRANSITION_SQL, [
            instanceId,
            result.transition.from,
            result.transition.to,
            result.transition.reason,
            new Date(result.transition.occurredAt).toISOString(),
          ]);
        }
      }
    } else if (action.action === 'update' || action.action === 'recover') {
      // Capture the active instance BEFORE the state update: after a `recover`
      // the row is terminal and the active-instance lookup returns null.
      const activeBefore = await getActiveAlertInstance(client, { ruleId: rule.id });
      const recoveredAt = action.action === 'recover' ? new Date(action.recoveredAt).toISOString() : null;
      const recoverySince =
        action.action === 'update' && action.recoverySince !== undefined && action.recoverySince !== null
          ? new Date(action.recoverySince).toISOString()
          : null;
      const pausedFrom = action.action === 'update' ? (action.pausedFrom ?? null) : null;
      const pauseReason = action.action === 'update' ? (action.pauseReason ?? null) : null;
      await client.query(UPDATE_INSTANCE_SQL, [
        rule.id,
        action.action === 'recover' ? 'recovered' : action.state,
        recoverySince,
        recoveredAt,
        pausedFrom,
        pauseReason,
      ]);
      if (activeBefore !== null && result.transition !== null) {
        await client.query(UPSERT_EVIDENCE_SQL, evidenceParams(activeBefore.id, result));
        await client.query(INSERT_TRANSITION_SQL, [
          activeBefore.id,
          result.transition.from,
          result.transition.to,
          result.transition.reason,
          new Date(result.transition.occurredAt).toISOString(),
        ]);
      }
    }
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // The round records per-rule failure; never leak DB details.
    throw new Error('alert evaluation persistence failed');
  } finally {
    client.release();
  }
}

const LIST_INSTANCES_SQL = `
  SELECT i.id, i.rule_id, i.state, i.triggered_at, i.recovered_at, i.pause_reason,
         r.name AS rule_name, r.metric
  FROM alert_instances i
  JOIN alert_rules r ON r.id = i.rule_id
  WHERE i.project_id = $1
  ORDER BY i.triggered_at DESC, i.id DESC
  LIMIT 200
`;

/** C10 instances tab: bounded most-recent instances for a project. */
export async function queryAlertInstances(
  pool: Pool,
  input: { readonly projectId: string },
): Promise<AlertInstanceSummary[]> {
  const result = await pool.query<{
    id: string;
    rule_id: string;
    state: string;
    triggered_at: Date;
    recovered_at: Date | null;
    pause_reason: string | null;
    rule_name: string | null;
    metric: string;
  }>(LIST_INSTANCES_SQL, [input.projectId]);
  return result.rows.map((row) => ({
    instanceId: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    metric: row.metric as AlertInstanceSummary['metric'],
    state: row.state,
    triggeredAt: row.triggered_at.toISOString(),
    recoveredAt: row.recovered_at === null ? null : row.recovered_at.toISOString(),
    pauseReason: row.pause_reason,
  }));
}

const INSTANCE_DETAIL_SQL = `
  SELECT i.id, i.rule_id, i.state, i.triggered_at, i.recovery_since, i.recovered_at,
         i.paused_from, i.pause_reason, i.rule_snapshot,
         r.name AS rule_name, r.metric
  FROM alert_instances i
  JOIN alert_rules r ON r.id = i.rule_id
  WHERE i.id = $1 AND i.project_id = $2
`;

const EVIDENCE_SQL = `
  SELECT evaluated_at, state_after, window_start_at, window_end_at, observed_value,
         numerator, denominator, sample_count, min_sample_requirement, watermark_at,
         completeness, pause_reason, applied_filters
  FROM alert_instance_evidence
  WHERE instance_id = $1
`;

const TRANSITIONS_SQL = `
  SELECT from_state, to_state, reason, occurred_at
  FROM alert_instance_transitions
  WHERE instance_id = $1
  ORDER BY occurred_at ASC, id ASC
`;

export interface AlertInstanceDetail {
  readonly instance: AlertInstanceRow & { readonly ruleName: string | null; readonly metric: string };
  readonly evidence: AlertEvidenceRow | null;
  readonly transitions: readonly AlertTransitionRow[];
}

function toEvidenceRow(row: {
  evaluated_at: Date;
  state_after: string;
  window_start_at: Date;
  window_end_at: Date;
  observed_value: string | null;
  numerator: string | null;
  denominator: string | null;
  sample_count: number | null;
  min_sample_requirement: number | null;
  watermark_at: Date | null;
  completeness: string;
  pause_reason: string | null;
  applied_filters: unknown;
}): AlertEvidenceRow {
  return {
    evaluatedAt: row.evaluated_at,
    stateAfter: row.state_after,
    windowStartAt: row.window_start_at,
    windowEndAt: row.window_end_at,
    observedValue: row.observed_value === null ? null : Number(row.observed_value),
    numerator: row.numerator === null ? null : Number(row.numerator),
    denominator: row.denominator === null ? null : Number(row.denominator),
    sampleCount: row.sample_count,
    minSampleRequirement: row.min_sample_requirement,
    watermarkAt: row.watermark_at,
    completeness: row.completeness,
    pauseReason: row.pause_reason,
    appliedFilters: row.applied_filters as AlertEvidenceRow['appliedFilters'],
  };
}

/** C12 instance detail: instance + current evidence + rule snapshot + timeline. */
export async function queryAlertInstanceDetail(
  pool: Pool,
  input: { readonly projectId: string; readonly instanceId: string },
): Promise<AlertInstanceDetail | null> {
  const instanceResult = await pool.query<{
    id: string;
    rule_id: string;
    state: string;
    triggered_at: Date;
    recovery_since: Date | null;
    recovered_at: Date | null;
    paused_from: string | null;
    pause_reason: string | null;
    rule_snapshot: unknown;
    rule_name: string | null;
    metric: string;
  }>(INSTANCE_DETAIL_SQL, [input.instanceId, input.projectId]);
  const instanceRow = instanceResult.rows[0];
  if (instanceRow === undefined) return null;
  const [evidenceResult, transitionsResult] = await Promise.all([
    pool.query(EVIDENCE_SQL, [input.instanceId]),
    pool.query(TRANSITIONS_SQL, [input.instanceId]),
  ]);
  const instance: AlertInstanceDetail['instance'] = {
    id: instanceRow.id,
    ruleId: instanceRow.rule_id,
    projectId: input.projectId,
    state: instanceRow.state,
    triggeredAt: instanceRow.triggered_at,
    recoverySince: instanceRow.recovery_since,
    recoveredAt: instanceRow.recovered_at,
    pausedFrom: instanceRow.paused_from,
    pauseReason: instanceRow.pause_reason,
    ruleSnapshot: instanceRow.rule_snapshot as Record<string, unknown>,
    ruleName: instanceRow.rule_name,
    metric: instanceRow.metric,
  };
  const evidenceRow = evidenceResult.rows[0];
  return {
    instance,
    evidence: evidenceRow === undefined ? null : toEvidenceRow(evidenceRow),
    transitions: transitionsResult.rows.map((t) => ({
      fromState: t.from_state,
      toState: t.to_state,
      reason: t.reason,
      occurredAt: t.occurred_at,
    })),
  };
}
