/**
 * DAT-19 alert evaluation domain types (PRD §11.2.3—§11.2.10).
 *
 * These constants are the processing-store's canonical fixed-option set (the
 * DB CHECK rules and the evaluator both derive from them). The public
 * `@aurora/platform-contract` declares the same values for the machine API; the
 * two must stay in sync (see issue-status precedent).
 */

export const ALERT_METRIC_VALUES = [
  'error_count',
  'new_issue_count',
  'issue_reappearance_count',
  'request_failure_rate',
  'slow_request_count',
  'lcp_ratio',
  'inp_ratio',
  'cls_ratio',
] as const;

export type AlertMetric = (typeof ALERT_METRIC_VALUES)[number];

/** PRD §11.2.1 — proportion metrics that require a minimum sample count (§11.2.7). */
export const ALERT_RATIO_METRICS: readonly string[] = [
  'request_failure_rate',
  'lcp_ratio',
  'inp_ratio',
  'cls_ratio',
] as const;

export const ALERT_WINDOWS_MINUTES: readonly number[] = [1, 5, 10, 30, 60] as const;
/** PRD §11.2.4 — 0 means "immediate" (no sustained duration). */
export const ALERT_TRIGGER_DURATIONS_MINUTES: readonly number[] = [0, 1, 2, 5, 10] as const;
export const ALERT_COOLDOWN_MINUTES: readonly number[] = [5, 10, 30, 60] as const;

export const ALERT_RULE_EVALUATION_STATES = [
  'normal',
  'pending_trigger',
  'triggered',
  'pending_recovery',
  'evaluation_paused',
] as const;

export type AlertRuleEvaluationState = (typeof ALERT_RULE_EVALUATION_STATES)[number];

/**
 * Instance lifecycle states. Instances are created only when a rule's full
 * trigger condition is satisfied; `pending_trigger` is a rule evaluation
 * projection. `recovered` is terminal (PRD §11.2.9).
 */
export const ALERT_INSTANCE_STATES = [
  'triggered',
  'pending_recovery',
  'recovered',
  'evaluation_paused',
] as const;

export type AlertInstanceState = (typeof ALERT_INSTANCE_STATES)[number];

export const ALERT_FILTER_DIMENSIONS = [
  'environment',
  'release',
  'page_or_endpoint',
  'error_severity',
] as const;

export type AlertFilterDimension = (typeof ALERT_FILTER_DIMENSIONS)[number];

export interface AlertFilterValues {
  readonly environment: readonly string[];
  readonly release: readonly string[];
  readonly pageOrEndpoint: readonly string[];
  readonly errorSeverity: readonly string[];
}

/** First-version filters are always empty: no event-side data source exists yet. */
export const EMPTY_ALERT_FILTERS: AlertFilterValues = Object.freeze({
  environment: [],
  release: [],
  pageOrEndpoint: [],
  errorSeverity: [],
});

/** Frozen rule config consumed by the pure evaluator (decoupled from storage). */
export interface AlertRuleConfig {
  readonly metric: AlertMetric;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes: number;
  readonly minSampleCount: number | null;
  readonly cooldownMinutes: number;
  readonly isRatio: boolean;
}

/**
 * Rule-level current evaluation projection. `since` is the continuity anchor
 * (epoch ms) for the in-progress trigger accumulation; it is reset to null when
 * the accumulation is canceled or paused (gaps break continuity).
 */
export interface AlertRuleEvaluation {
  readonly state: AlertRuleEvaluationState;
  readonly since: number | null;
  readonly lastEvaluatedAt: number;
  readonly pauseReason: string | null;
}

export const EMPTY_ALERT_RULE_EVALUATION: AlertRuleEvaluation = Object.freeze({
  state: 'normal',
  since: null,
  lastEvaluatedAt: 0,
  pauseReason: null,
});

/** A trustworthy metric observation, or an explicit "cannot judge" pause. */
export type AlertObservation =
  | {
      readonly kind: 'data';
      /** Observed metric value (count, or proportion expressed as percentage 0..100). */
      readonly value: number;
      readonly numerator?: number;
      readonly denominator?: number;
      readonly sampleCount?: number;
      readonly windowStart: number;
      readonly windowEnd: number;
      readonly watermark: number;
    }
  | {
      readonly kind: 'missing';
      readonly pauseReason: string;
      readonly windowStart: number;
      readonly windowEnd: number;
    };

/** The active instance, when a rule has already triggered (before recovery). */
export interface ActiveAlertInstance {
  readonly state: 'triggered' | 'pending_recovery' | 'evaluation_paused';
  readonly triggeredAt: number;
  readonly recoverySince: number | null;
  readonly pausedFrom: 'triggered' | 'pending_recovery' | null;
}

export type AlertEvidenceCompleteness = 'complete' | 'insufficient' | 'missing';

/** Evaluation evidence that drove the current instance judgment (C12). */
export interface AlertEvidenceRecord {
  readonly evaluatedAt: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly observedValue: number | null;
  readonly numerator: number | null;
  readonly denominator: number | null;
  readonly sampleCount: number | null;
  readonly minSampleRequirement: number | null;
  readonly watermark: number | null;
  readonly completeness: AlertEvidenceCompleteness;
  readonly pauseReason: string | null;
  readonly appliedFilters: AlertFilterValues;
}

/** One confirmed business transition on the instance timeline (C12). */
export interface AlertTransition {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly occurredAt: number;
}

export type AlertInstanceAction =
  | { readonly action: 'none' }
  | { readonly action: 'create'; readonly state: 'triggered'; readonly triggeredAt: number }
  | {
      readonly action: 'update';
      readonly state: 'triggered' | 'pending_recovery' | 'evaluation_paused';
      readonly recoverySince?: number | null;
      readonly pausedFrom?: 'triggered' | 'pending_recovery' | null;
      readonly pauseReason?: string | null;
    }
  | { readonly action: 'recover'; readonly recoveredAt: number };

/**
 * Cooldown (PRD §11.2.6) only gates repeat notifications — it never changes
 * alert state. DAT-19 records the decision and `last_notified_at`; it does not
 * send notifications (G13/D1 deferred).
 */
export type AlertNotificationDecision =
  'first_trigger' | 'retrigger' | 'recovered' | 'suppressed' | 'none';

export interface EvaluateAlertRoundInput {
  readonly rule: AlertRuleConfig;
  readonly observation: AlertObservation;
  readonly ruleEval: AlertRuleEvaluation;
  readonly instance: ActiveAlertInstance | null;
  /** Rule-level last notification time (cooldown reference, persists across instances). */
  readonly lastNotifiedAt: number | null;
  readonly now: number;
}

export interface EvaluateAlertRoundResult {
  readonly ruleEval: AlertRuleEvaluation;
  /** Instance-timeline transition to append (null when no instance state change). */
  readonly transition: AlertTransition | null;
  readonly instanceAction: AlertInstanceAction;
  readonly evidence: AlertEvidenceRecord;
  readonly notification: AlertNotificationDecision;
  /** True when the rule's `last_notified_at` must be updated to `nextLastNotifiedAt`. */
  readonly notifyNow: boolean;
  readonly nextLastNotifiedAt: number;
}
