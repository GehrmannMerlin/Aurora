/**
 * OPS-06 operational alert rules (测试/部署设计 §12.2; deployment.md §6).
 *
 * Pure data + validation. These are Aurora platform-run alerts only — product
 * alerts (DAT-19, user-configured Issue/performance alerts per PRD §11) are
 * NEVER part of this model: every rule carries `productAlert: false` and
 * `validateOperationalAlertRules` rejects any rule that flips it.
 *
 * Every rule references an operational Runbook under docs/operations/runbooks/.
 * Exact thresholds are `requires-benchmark` (ING-13) until production evidence.
 */

import type { MetricSeverity } from './metrics-contract.js';

export interface OperationalAlertRule {
  readonly id: string;
  readonly title: string;
  readonly severity: MetricSeverity;
  /** Custom metric under Aurora/Operational, or a mapped native metric name. */
  readonly metric: string;
  readonly statistic: 'Sum' | 'Average' | 'Maximum';
  readonly periodSeconds: number;
  readonly evaluationPeriods: number;
  readonly threshold: number;
  readonly comparisonOperator:
    | 'GreaterThanThreshold'
    | 'GreaterThanOrEqualToThreshold'
    | 'LessThanThreshold'
    | 'LessThanOrEqualToThreshold';
  /** Relative runbook path under docs/operations/runbooks/. */
  readonly runbook: string;
  /** Product alerts (DAT-19) must never enter the operational alert model. */
  readonly productAlert: false;
}

export const OPERATIONAL_ALERT_RULES: readonly OperationalAlertRule[] = Object.freeze([
  {
    id: 'ops-ingestion-error-rate',
    title: 'ingestion error rate elevated',
    severity: 'P1',
    metric: 'Aurora/Ingestion/ErrorCount',
    statistic: 'Sum',
    periodSeconds: 300,
    evaluationPeriods: 2,
    threshold: 10,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/ingestion-error-rate.md',
    productAlert: false,
  },
  {
    id: 'ops-ingestion-availability',
    title: 'ingestion availability below SLO',
    severity: 'P1',
    metric: 'Ingestion.Availability',
    statistic: 'Average',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 0.999,
    comparisonOperator: 'LessThanThreshold',
    runbook: '../operations/runbooks/ingestion-availability.md',
    productAlert: false,
  },
  {
    id: 'ops-processing-lag',
    title: 'processing lag exceeds freshness SLO',
    severity: 'P1',
    metric: 'Processing.LagSeconds',
    statistic: 'Maximum',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 300,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/processing-lag-dead-letter.md',
    productAlert: false,
  },
  {
    id: 'ops-processing-dead-letter',
    title: 'dead-lettered events detected',
    severity: 'P1',
    metric: 'Processing.DeadLettered',
    statistic: 'Sum',
    periodSeconds: 300,
    evaluationPeriods: 1,
    threshold: 0,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/processing-lag-dead-letter.md',
    productAlert: false,
  },
  {
    id: 'ops-db-cpu',
    title: 'postgres cpu saturation',
    severity: 'P2',
    metric: 'DB.CPUUtilization',
    statistic: 'Average',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 80,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/postgresql-saturation.md',
    productAlert: false,
  },
  {
    id: 'ops-db-storage',
    title: 'postgres free storage low',
    severity: 'P2',
    metric: 'DB.FreeStorageBytes',
    statistic: 'Average',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 5368709120,
    comparisonOperator: 'LessThanThreshold',
    runbook: '../operations/runbooks/postgresql-saturation.md',
    productAlert: false,
  },
  {
    id: 'ops-db-connections',
    title: 'postgres connection saturation',
    severity: 'P2',
    metric: 'DB.Connections',
    statistic: 'Maximum',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 100,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/postgresql-saturation.md',
    productAlert: false,
  },
  {
    id: 'ops-worker-restarts',
    title: 'worker task down / restart loop',
    severity: 'P1',
    metric: 'Worker.FailureCount',
    statistic: 'Sum',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 3,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/worker-and-deployment-failure.md',
    productAlert: false,
  },
  {
    id: 'ops-worker-down',
    title: 'worker healthy task count zero',
    severity: 'P1',
    metric: 'ECS.RunningTaskCount',
    statistic: 'Average',
    periodSeconds: 300,
    evaluationPeriods: 3,
    threshold: 0,
    comparisonOperator: 'LessThanOrEqualToThreshold',
    runbook: '../operations/runbooks/worker-and-deployment-failure.md',
    productAlert: false,
  },
  {
    id: 'ops-deployment-failure',
    title: 'ecs deployment circuit breaker fired',
    severity: 'P0',
    metric: 'Deployment.Failed',
    statistic: 'Sum',
    periodSeconds: 300,
    evaluationPeriods: 1,
    threshold: 0,
    comparisonOperator: 'GreaterThanThreshold',
    runbook: '../operations/runbooks/worker-and-deployment-failure.md',
    productAlert: false,
  },
]);

const VALID_OPERATORS = new Set([
  'GreaterThanThreshold',
  'GreaterThanOrEqualToThreshold',
  'LessThanThreshold',
  'LessThanOrEqualToThreshold',
]);

/**
 * Widened input shape so the guards are meaningful at runtime: a hostile or
 * hand-crafted rule object (e.g. `{ productAlert: true }`) is caught even
 * though the typed `OperationalAlertRule` narrows `productAlert` to `false`.
 */
export type AlertRuleInput = Omit<
  OperationalAlertRule,
  'productAlert' | 'severity' | 'comparisonOperator'
> & {
  readonly productAlert: boolean;
  readonly severity: string;
  readonly comparisonOperator: string;
};

export function validateOperationalAlertRules(rules: readonly AlertRuleInput[]): readonly string[] {
  const violations: string[] = [];
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) violations.push(`duplicate-id:${rule.id}`);
    ids.add(rule.id);
    if (rule.productAlert) violations.push(`product-alert-forbidden:${rule.id}`);
    if (rule.severity !== 'P0' && rule.severity !== 'P1' && rule.severity !== 'P2') {
      violations.push(`invalid-severity:${rule.id}`);
    }
    if (!Number.isFinite(rule.threshold)) violations.push(`invalid-threshold:${rule.id}`);
    if (rule.periodSeconds <= 0 || rule.evaluationPeriods <= 0) {
      violations.push(`invalid-window:${rule.id}`);
    }
    if (!VALID_OPERATORS.has(rule.comparisonOperator)) {
      violations.push(`invalid-operator:${rule.id}`);
    }
    if (!rule.runbook.startsWith('../operations/runbooks/')) {
      violations.push(`invalid-runbook-ref:${rule.id}`);
    }
  }
  return Object.freeze(violations);
}
