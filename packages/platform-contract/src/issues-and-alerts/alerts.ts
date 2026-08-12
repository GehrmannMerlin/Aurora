import { arr, bool, enum_, num, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { sectionResult } from '../common/section.js';
import { utcTimestamp } from '../common/time.js';
import {
  AccountId,
  AlertInstanceId,
  AlertRuleId,
  OrganizationId,
  ProjectId,
} from '../common/identifiers.js';

/**
 * DAT-19 alert rule / instance contract (PRD §11, C10—C12).
 *
 * Product alerts only — OPS-06 operational alerting (platform observability /
 * SLO / runbooks) is a separate concern and never exposed here. Fixed options
 * come verbatim from PRD §11.2.3 / §11.2.4 / §11.2.6. `recovered` is an
 * instance terminal state; a rule re-triggering creates a new instance.
 */

export const OPERATION_ID_ALERTS_GET_CAPABILITY = 'alertsGetCapability' as const;
export const OPERATION_ID_ALERTS_LIST = 'alertsListRulesAndInstances' as const;
export const OPERATION_ID_ALERTS_CREATE_RULE = 'alertsCreateRule' as const;
export const OPERATION_ID_ALERTS_UPDATE_RULE = 'alertsUpdateRule' as const;
export const OPERATION_ID_ALERTS_GET_INSTANCE = 'alertsGetInstanceDetail' as const;

export const ALERT_METRIC = {
  ErrorCount: 'error_count',
  NewIssueCount: 'new_issue_count',
  IssueReappearanceCount: 'issue_reappearance_count',
  RequestFailureRate: 'request_failure_rate',
  SlowRequestCount: 'slow_request_count',
  LcpRatio: 'lcp_ratio',
  InpRatio: 'inp_ratio',
  ClsRatio: 'cls_ratio',
} as const;

export type AlertMetric = (typeof ALERT_METRIC)[keyof typeof ALERT_METRIC];

export const ALERT_METRIC_VALUES: readonly AlertMetric[] = Object.values(ALERT_METRIC);

/** PRD §11.2.1 — metrics that need a minimum sample count (proportion metrics). */
export const ALERT_RATIO_METRICS: readonly AlertMetric[] = [
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
 * Instance lifecycle states. Instances are created when a rule's full trigger
 * condition is satisfied (PRD §11.2.9 + C10 §7.25 "whether an instance already
 * exists is decided by the formal contract"): `pending_trigger` is a rule
 * evaluation projection, not an instance. `recovered` is terminal.
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

export const alertFilterValues = obj({
  environment: arr(str(1, 256), 0, 50),
  release: arr(str(1, 256), 0, 50),
  pageOrEndpoint: arr(str(1, 256), 0, 50),
  errorSeverity: arr(str(1, 32), 0, 50),
});

export const alertRuleInput = obj({
  name: optional(str(1, 120)),
  metric: enum_(ALERT_METRIC_VALUES),
  filters: alertFilterValues,
  // Fixed numeric options (PRD §11.2.3/§11.2.4/§11.2.6) are non-contiguous and
  // therefore expressed as integers here; the fixed set is enforced by
  // server-side validation and exposed via `alertsGetCapability`.
  windowMinutes: num(1),
  triggerThreshold: num(0),
  triggerDurationMinutes: num(0),
  recoveryThreshold: num(0),
  recoveryDurationMinutes: optional(num(0)),
  minSampleCount: optional(num(1)),
  cooldownMinutes: num(1),
  recipientAccountIds: arr(AccountId, 1, 50),
  idempotencyKey: str(8, 128),
});

const alertRuleEvaluationProjection = obj({
  state: enum_(ALERT_RULE_EVALUATION_STATES),
  observedValue: optional(num(0)),
  sinceAt: optional(utcTimestamp),
  lastEvaluatedAt: optional(utcTimestamp),
  pauseReason: optional(str(1, 64)),
});

const alertRuleSummary = obj({
  ruleId: AlertRuleId,
  name: optional(str(1, 120)),
  metric: enum_(ALERT_METRIC_VALUES),
  windowMinutes: num(1),
  triggerThreshold: num(0),
  recoveryThreshold: num(0),
  recipientAccountIds: arr(AccountId, 1, 50),
  evaluation: alertRuleEvaluationProjection,
  version: num(1),
});

const alertInstanceSummary = obj({
  instanceId: AlertInstanceId,
  ruleId: AlertRuleId,
  ruleName: optional(str(1, 120)),
  metric: enum_(ALERT_METRIC_VALUES),
  state: enum_(ALERT_INSTANCE_STATES),
  triggeredAt: utcTimestamp,
  recoveredAt: optional(utcTimestamp),
  pauseReason: optional(str(1, 64)),
});

const alertMetricCapability = obj({
  metric: enum_(ALERT_METRIC_VALUES),
  displayName: str(1, 64),
  unit: enum_(['count', 'percentage']),
  direction: enum_(['higher_is_worse']),
  isRatio: bool(),
  minSamplesRequired: bool(),
  filterDimensions: arr(enum_(ALERT_FILTER_DIMENSIONS), 0, 4),
});

const alertFilterDimensionStatus = obj({
  id: enum_(ALERT_FILTER_DIMENSIONS),
  available: bool(),
  reason: optional(str(1, 128)),
});

export const alertsGetCapabilityPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const alertsGetCapabilityResponse = queryResponse(
  obj({
    metrics: arr(alertMetricCapability, 8, 8),
    windowsMinutes: arr(num(1), 5, 5),
    triggerDurationsMinutes: arr(num(0), 5, 5),
    cooldownsMinutes: arr(num(1), 4, 4),
    filterDimensions: arr(alertFilterDimensionStatus, 4, 4),
    recipients: arr(obj({ accountId: AccountId, maskedEmail: str(1, 320) }), 0, 200),
  }),
);

export const alertsListRulesAndInstancesPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const alertsListRulesAndInstancesQuery = obj({});

export const alertsListRulesAndInstancesResponse = queryResponse(
  obj({
    rules: sectionResult(obj({ items: arr(alertRuleSummary, 0, 100) })),
    instances: sectionResult(
      obj({
        items: arr(alertInstanceSummary, 0, 200),
        count: num(0),
        totalCountStatus: enum_(['available', 'bounded', 'unknown']),
      }),
    ),
  }),
);

export const alertsCreateRulePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const alertsCreateRuleBody = alertRuleInput;

export const alertsCreateRuleResponse = obj({
  data: obj({
    status: str(1, 16),
    ruleId: AlertRuleId,
  }),
});

export const alertsUpdateRulePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  ruleId: AlertRuleId,
});

export const alertsUpdateRuleBody = alertRuleInput;

export const alertsUpdateRuleResponse = obj({
  data: obj({
    status: str(1, 16),
    ruleId: AlertRuleId,
    version: num(1),
  }),
});

export const alertsGetInstanceDetailPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  instanceId: AlertInstanceId,
});

const alertInstanceRuleSnapshot = obj({
  name: optional(str(1, 120)),
  metric: enum_(ALERT_METRIC_VALUES),
  filters: alertFilterValues,
  windowMinutes: num(1),
  triggerThreshold: num(0),
  triggerDurationMinutes: num(0),
  recoveryThreshold: num(0),
  recoveryDurationMinutes: num(0),
  minSampleCount: optional(num(1)),
  cooldownMinutes: num(1),
});

const alertInstanceEvidence = obj({
  evaluatedAt: utcTimestamp,
  windowStartAt: utcTimestamp,
  windowEndAt: utcTimestamp,
  observedValue: optional(num(0)),
  numerator: optional(num(0)),
  denominator: optional(num(0)),
  sampleCount: optional(num(0)),
  minSampleRequirement: optional(num(1)),
  watermarkAt: optional(utcTimestamp),
  completeness: enum_(['complete', 'insufficient', 'missing']),
  pauseReason: optional(str(1, 64)),
  appliedFilters: alertFilterValues,
});

const alertInstanceTransition = obj({
  from: str(1, 32),
  to: str(1, 32),
  reason: str(1, 64),
  occurredAt: utcTimestamp,
});

export const alertsGetInstanceDetailResponse = queryResponse(
  obj({
    instance: obj({
      instanceId: AlertInstanceId,
      ruleId: AlertRuleId,
      ruleName: optional(str(1, 120)),
      metric: enum_(ALERT_METRIC_VALUES),
      state: enum_(ALERT_INSTANCE_STATES),
      directReason: str(1, 64),
      triggeredAt: utcTimestamp,
      recoveredAt: optional(utcTimestamp),
      pauseReason: optional(str(1, 64)),
    }),
    ruleSnapshot: alertInstanceRuleSnapshot,
    evidence: alertInstanceEvidence,
    transitions: arr(alertInstanceTransition, 0, 100),
  }),
);

/**
 * Static capability contract (PRD §11 fixed options). Consumed by the C11 rule
 * form and exposed as a stable machine contract so the frontend never maintains
 * a second drift-prone metric matrix. All first-version metrics are
 * higher-is-worse; all proportion metrics require a minimum sample count.
 */
export const ALERT_CAPABILITY_METRICS: readonly {
  readonly metric: AlertMetric;
  readonly displayName: string;
  readonly unit: 'count' | 'percentage';
  readonly direction: 'higher_is_worse';
  readonly isRatio: boolean;
  readonly minSamplesRequired: boolean;
  readonly filterDimensions: readonly AlertFilterDimension[];
}[] = Object.freeze([
  {
    metric: 'error_count',
    displayName: 'Error count',
    unit: 'count',
    direction: 'higher_is_worse',
    isRatio: false,
    minSamplesRequired: false,
    filterDimensions: ['environment', 'release', 'page_or_endpoint', 'error_severity'],
  },
  {
    metric: 'new_issue_count',
    displayName: 'New issue count',
    unit: 'count',
    direction: 'higher_is_worse',
    isRatio: false,
    minSamplesRequired: false,
    filterDimensions: ['environment', 'release', 'page_or_endpoint', 'error_severity'],
  },
  {
    metric: 'issue_reappearance_count',
    displayName: 'Issue reappearance count',
    unit: 'count',
    direction: 'higher_is_worse',
    isRatio: false,
    minSamplesRequired: false,
    filterDimensions: ['environment', 'release', 'page_or_endpoint', 'error_severity'],
  },
  {
    metric: 'request_failure_rate',
    displayName: 'Request failure rate',
    unit: 'percentage',
    direction: 'higher_is_worse',
    isRatio: true,
    minSamplesRequired: true,
    filterDimensions: ['environment', 'release', 'page_or_endpoint'],
  },
  {
    metric: 'slow_request_count',
    displayName: 'Slow request count',
    unit: 'count',
    direction: 'higher_is_worse',
    isRatio: false,
    minSamplesRequired: false,
    filterDimensions: ['environment', 'release', 'page_or_endpoint'],
  },
  {
    metric: 'lcp_ratio',
    displayName: 'LCP exceeded ratio',
    unit: 'percentage',
    direction: 'higher_is_worse',
    isRatio: true,
    minSamplesRequired: true,
    filterDimensions: ['environment', 'release', 'page_or_endpoint'],
  },
  {
    metric: 'inp_ratio',
    displayName: 'INP exceeded ratio',
    unit: 'percentage',
    direction: 'higher_is_worse',
    isRatio: true,
    minSamplesRequired: true,
    filterDimensions: ['environment', 'release', 'page_or_endpoint'],
  },
  {
    metric: 'cls_ratio',
    displayName: 'CLS exceeded ratio',
    unit: 'percentage',
    direction: 'higher_is_worse',
    isRatio: true,
    minSamplesRequired: true,
    filterDimensions: ['environment', 'release', 'page_or_endpoint'],
  },
]);
