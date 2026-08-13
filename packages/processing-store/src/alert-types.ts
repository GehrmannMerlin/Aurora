import type { AlertFilterValues, AlertMetric, AlertRuleConfig } from './alert-evaluator-types.js';
import { isRatioMetric } from './alert-evaluator.js';

/** Persistent alert rule row (columns of `alert_rules`). */
export interface AlertRuleRow {
  readonly id: string;
  readonly projectId: string;
  readonly name: string | null;
  readonly metric: AlertMetric;
  readonly filters: AlertFilterValues;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes: number;
  readonly minSampleCount: number | null;
  readonly cooldownMinutes: number;
  readonly recipientAccountIds: readonly string[];
  readonly version: number;
  readonly evaluationState: string;
  readonly evaluationSince: Date | null;
  readonly lastEvaluatedAt: Date | null;
  readonly evaluationPauseReason: string | null;
  readonly lastObservedValue: number | null;
  readonly lastNotifiedAt: Date | null;
}

export interface CreateAlertRuleInput {
  readonly projectId: string;
  readonly name?: string;
  readonly metric: AlertMetric;
  readonly filters: AlertFilterValues;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes?: number;
  readonly minSampleCount: number | null;
  readonly cooldownMinutes: number;
  readonly recipientAccountIds: readonly string[];
}

export type CreateAlertRuleResult =
  | { readonly status: 'inserted'; readonly ruleId: string }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export interface UpdateAlertRuleInput extends CreateAlertRuleInput {
  readonly ruleId: string;
  readonly version: number;
}

export type UpdateAlertRuleResult =
  | { readonly status: 'updated'; readonly ruleId: string; readonly version: number }
  | { readonly status: 'not_found' }
  | { readonly status: 'version_conflict' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/** Rule config consumed by the pure evaluator, derived from a rule row. */
export function toAlertRuleConfig(rule: AlertRuleRow): AlertRuleConfig {
  return {
    metric: rule.metric,
    windowMinutes: rule.windowMinutes,
    triggerThreshold: rule.triggerThreshold,
    triggerDurationMinutes: rule.triggerDurationMinutes,
    recoveryThreshold: rule.recoveryThreshold,
    recoveryDurationMinutes: rule.recoveryDurationMinutes,
    minSampleCount: rule.minSampleCount,
    cooldownMinutes: rule.cooldownMinutes,
    isRatio: isRatioMetric(rule.metric),
  };
}

/** Safe rule snapshot frozen into an instance at creation (C12, rule/instance separation). */
export function buildAlertRuleSnapshot(rule: AlertRuleRow): Record<string, unknown> {
  const undef = <T>(value: T | null): T | undefined => value ?? undefined;
  return {
    name: undef(rule.name),
    metric: rule.metric,
    filters: rule.filters,
    windowMinutes: rule.windowMinutes,
    triggerThreshold: rule.triggerThreshold,
    triggerDurationMinutes: rule.triggerDurationMinutes,
    recoveryThreshold: rule.recoveryThreshold,
    recoveryDurationMinutes: rule.recoveryDurationMinutes,
    minSampleCount: undef(rule.minSampleCount),
    cooldownMinutes: rule.cooldownMinutes,
  };
}

/** Persistent alert instance row (columns of `alert_instances`). */
export interface AlertInstanceRow {
  readonly id: string;
  readonly ruleId: string;
  readonly projectId: string;
  readonly state: string;
  readonly triggeredAt: Date;
  readonly recoverySince: Date | null;
  readonly recoveredAt: Date | null;
  readonly pausedFrom: string | null;
  readonly pauseReason: string | null;
  readonly ruleSnapshot: Record<string, unknown>;
}

/** Active (non-recovered) instance for the evaluator. */
export interface AlertInstanceSummary {
  readonly instanceId: string;
  readonly ruleId: string;
  readonly ruleName: string | null;
  readonly metric: AlertMetric;
  readonly state: string;
  readonly triggeredAt: string;
  readonly recoveredAt: string | null;
  readonly pauseReason: string | null;
}

export interface AlertEvidenceRow {
  readonly evaluatedAt: Date;
  readonly stateAfter: string;
  readonly windowStartAt: Date;
  readonly windowEndAt: Date;
  readonly observedValue: number | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly sampleCount: number | null;
  readonly minSampleRequirement: number | null;
  readonly watermarkAt: Date | null;
  readonly completeness: string;
  readonly pauseReason: string | null;
  readonly appliedFilters: AlertFilterValues;
}

export interface AlertTransitionRow {
  readonly fromState: string;
  readonly toState: string;
  readonly reason: string;
  readonly occurredAt: Date;
}
