import type { Pool, PoolClient } from 'pg';
import {
  ALERT_COOLDOWN_MINUTES,
  ALERT_METRIC_VALUES,
  ALERT_TRIGGER_DURATIONS_MINUTES,
  ALERT_WINDOWS_MINUTES,
  type AlertFilterValues,
} from './alert-evaluator-types.js';
import { isRatioMetric } from './alert-evaluator.js';
import type {
  AlertRuleRow,
  CreateAlertRuleInput,
  CreateAlertRuleResult,
  UpdateAlertRuleInput,
  UpdateAlertRuleResult,
} from './alert-types.js';

const RULE_COLUMNS = `
  id, project_id, name, metric, filters, window_minutes, trigger_threshold,
  trigger_duration_minutes, recovery_threshold, recovery_duration_minutes,
  min_sample_count, cooldown_minutes, recipient_account_ids, version,
  evaluation_state, evaluation_since, last_evaluated_at, evaluation_pause_reason,
  last_observed_value, last_notified_at
`;

interface AlertRuleRowShape {
  id: string;
  project_id: string;
  name: string | null;
  metric: string;
  filters: unknown;
  window_minutes: number;
  trigger_threshold: string;
  trigger_duration_minutes: number;
  recovery_threshold: string;
  recovery_duration_minutes: number;
  min_sample_count: number | null;
  cooldown_minutes: number;
  recipient_account_ids: unknown;
  version: number;
  evaluation_state: string;
  evaluation_since: Date | null;
  last_evaluated_at: Date | null;
  evaluation_pause_reason: string | null;
  last_observed_value: string | null;
  last_notified_at: Date | null;
}

function toRuleRow(row: AlertRuleRowShape): AlertRuleRow {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    metric: row.metric as AlertRuleRow['metric'],
    filters: row.filters as AlertFilterValues,
    windowMinutes: row.window_minutes,
    triggerThreshold: Number(row.trigger_threshold),
    triggerDurationMinutes: row.trigger_duration_minutes,
    recoveryThreshold: Number(row.recovery_threshold),
    recoveryDurationMinutes: row.recovery_duration_minutes,
    minSampleCount: row.min_sample_count,
    cooldownMinutes: row.cooldown_minutes,
    recipientAccountIds: row.recipient_account_ids as readonly string[],
    version: row.version,
    evaluationState: row.evaluation_state,
    evaluationSince: row.evaluation_since,
    lastEvaluatedAt: row.last_evaluated_at,
    evaluationPauseReason: row.evaluation_pause_reason,
    lastObservedValue: row.last_observed_value === null ? null : Number(row.last_observed_value),
    lastNotifiedAt: row.last_notified_at,
  };
}

interface NormalizedRuleInput {
  readonly projectId: string;
  readonly name: string | null;
  readonly metric: string;
  readonly filters: AlertFilterValues;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes: number;
  readonly minSampleCount: number | null;
  readonly cooldownMinutes: number;
  readonly recipientAccountIds: readonly string[];
}

/**
 * PRD §11.2.8 config validation. First-version filters require a valid data
 * range; no error event carries environment/release/severity/page yet, so any
 * declared filter is rejected (`filter_dimension_unavailable`) rather than
 * silently producing an unfiltered observation.
 */
function normalizeRuleInput(
  input: CreateAlertRuleInput,
): { ok: true; value: NormalizedRuleInput } | { ok: false; code: string } {
  const { projectId, metric, windowMinutes, triggerDurationMinutes, cooldownMinutes } = input;
  if (!(ALERT_METRIC_VALUES as readonly string[]).includes(metric)) {
    return { ok: false, code: 'invalid_metric' };
  }
  if (!ALERT_WINDOWS_MINUTES.includes(windowMinutes)) {
    return { ok: false, code: 'invalid_window' };
  }
  if (!ALERT_TRIGGER_DURATIONS_MINUTES.includes(triggerDurationMinutes)) {
    return { ok: false, code: 'invalid_trigger_duration' };
  }
  if (!ALERT_COOLDOWN_MINUTES.includes(cooldownMinutes)) {
    return { ok: false, code: 'invalid_cooldown' };
  }
  const recoveryDurationMinutes = input.recoveryDurationMinutes ?? triggerDurationMinutes;
  if (!ALERT_TRIGGER_DURATIONS_MINUTES.includes(recoveryDurationMinutes)) {
    return { ok: false, code: 'invalid_recovery_duration' };
  }
  if (!(input.triggerThreshold >= 0) || !(input.recoveryThreshold >= 0)) {
    return { ok: false, code: 'invalid_threshold' };
  }
  // PRD §11.2.5: recovery threshold must be more lenient (lower for higher-is-worse).
  if (!(input.recoveryThreshold < input.triggerThreshold)) {
    return { ok: false, code: 'invalid_recovery_direction' };
  }
  if (isRatioMetric(metric) && !(input.minSampleCount !== null && input.minSampleCount > 0)) {
    return { ok: false, code: 'min_sample_required' };
  }
  if (input.minSampleCount !== null && input.minSampleCount <= 0) {
    return { ok: false, code: 'invalid_min_sample' };
  }
  if (input.recipientAccountIds.length < 1 || input.recipientAccountIds.length > 50) {
    return { ok: false, code: 'recipient_required' };
  }
  const filters = input.filters;
  if (
    filters.environment.length > 0 ||
    filters.release.length > 0 ||
    filters.pageOrEndpoint.length > 0 ||
    filters.errorSeverity.length > 0
  ) {
    return { ok: false, code: 'filter_dimension_unavailable' };
  }
  if (input.name !== undefined && (input.name.length < 1 || input.name.length > 120)) {
    return { ok: false, code: 'invalid_name' };
  }
  return {
    ok: true,
    value: {
      projectId,
      name: input.name ?? null,
      metric,
      filters,
      windowMinutes,
      triggerThreshold: input.triggerThreshold,
      triggerDurationMinutes,
      recoveryThreshold: input.recoveryThreshold,
      recoveryDurationMinutes,
      minSampleCount: input.minSampleCount,
      cooldownMinutes,
      recipientAccountIds: input.recipientAccountIds,
    },
  };
}

const INSERT_SQL = `
  INSERT INTO alert_rules
    (project_id, name, metric, filters, window_minutes, trigger_threshold,
     trigger_duration_minutes, recovery_threshold, recovery_duration_minutes,
     min_sample_count, cooldown_minutes, recipient_account_ids, evaluation_state)
  VALUES
    ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, 'normal')
  RETURNING id
`;

/**
 * Create an alert rule (project admin authorization is enforced by the API
 * layer; this repository validates the PRD §11.2.8 config and persists).
 */
export async function createAlertRule(
  pool: Pool | PoolClient,
  input: CreateAlertRuleInput,
): Promise<CreateAlertRuleResult> {
  const normalized = normalizeRuleInput(input);
  if (!normalized.ok) return { status: 'invalid_input', code: normalized.code };
  const rule = normalized.value;
  try {
    const result = await pool.query<{ id: string }>(INSERT_SQL, [
      rule.projectId,
      rule.name,
      rule.metric,
      JSON.stringify(rule.filters),
      rule.windowMinutes,
      rule.triggerThreshold,
      rule.triggerDurationMinutes,
      rule.recoveryThreshold,
      rule.recoveryDurationMinutes,
      rule.minSampleCount,
      rule.cooldownMinutes,
      JSON.stringify(rule.recipientAccountIds),
    ]);
    return { status: 'inserted', ruleId: result.rows[0]?.id ?? '' };
  } catch {
    return { status: 'temporarily_unavailable' };
  }
}

const UPDATE_SQL = `
  UPDATE alert_rules SET
    name = $3, metric = $4, filters = $5::jsonb, window_minutes = $6,
    trigger_threshold = $7, trigger_duration_minutes = $8,
    recovery_threshold = $9, recovery_duration_minutes = $10,
    min_sample_count = $11, cooldown_minutes = $12, recipient_account_ids = $13::jsonb,
    version = version + 1, updated_at = now()
  WHERE id = $1 AND project_id = $2 AND version = $14
  RETURNING version
`;

/**
 * Update an alert rule with optimistic versioning. Any version mismatch is a
 * `version_conflict` (never silently overwrite an edited rule).
 */
export async function updateAlertRule(
  pool: Pool | PoolClient,
  input: UpdateAlertRuleInput,
): Promise<UpdateAlertRuleResult> {
  const normalized = normalizeRuleInput(input);
  if (!normalized.ok) return { status: 'invalid_input', code: normalized.code };
  const rule = normalized.value;
  try {
    const result = await pool.query<{ version: number }>(UPDATE_SQL, [
      input.ruleId,
      rule.projectId,
      rule.name,
      rule.metric,
      JSON.stringify(rule.filters),
      rule.windowMinutes,
      rule.triggerThreshold,
      rule.triggerDurationMinutes,
      rule.recoveryThreshold,
      rule.recoveryDurationMinutes,
      rule.minSampleCount,
      rule.cooldownMinutes,
      JSON.stringify(rule.recipientAccountIds),
      input.version,
    ]);
    if (result.rows.length === 0) {
      const exists = await pool.query<{ id: string }>(
        'SELECT id FROM alert_rules WHERE id = $1 AND project_id = $2',
        [input.ruleId, rule.projectId],
      );
      return exists.rows.length === 0 ? { status: 'not_found' } : { status: 'version_conflict' };
    }
    return {
      status: 'updated',
      ruleId: input.ruleId,
      version: result.rows[0]?.version ?? input.version + 1,
    };
  } catch {
    return { status: 'temporarily_unavailable' };
  }
}

/**
 * List rules for a project with their current evaluation projection, ordered
 * by most recently updated (C10 rules tab).
 */
export async function listAlertRules(
  pool: Pool | PoolClient,
  input: { readonly projectId: string },
): Promise<AlertRuleRow[]> {
  const result = await pool.query<AlertRuleRowShape>(
    `SELECT ${RULE_COLUMNS} FROM alert_rules WHERE project_id = $1 ORDER BY updated_at DESC, id DESC`,
    [input.projectId],
  );
  return result.rows.map(toRuleRow);
}

/** Get one rule by id within a project (null when not found / cross-project). */
export async function getAlertRule(
  pool: Pool | PoolClient,
  input: { readonly projectId: string; readonly ruleId: string },
): Promise<AlertRuleRow | null> {
  const result = await pool.query<AlertRuleRowShape>(
    `SELECT ${RULE_COLUMNS} FROM alert_rules WHERE id = $1 AND project_id = $2`,
    [input.ruleId, input.projectId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toRuleRow(row);
}

/** Load the next batch of rules (oldest first) for one evaluation round. */
export async function listAlertRulesForEvaluation(
  pool: Pool | PoolClient,
  input: { readonly limit: number },
): Promise<AlertRuleRow[]> {
  const result = await pool.query<AlertRuleRowShape>(
    `SELECT ${RULE_COLUMNS} FROM alert_rules ORDER BY id ASC LIMIT $1`,
    [input.limit],
  );
  return result.rows.map(toRuleRow);
}
