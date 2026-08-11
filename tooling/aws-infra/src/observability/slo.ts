/**
 * OPS-06 SLO definitions + error-budget math (test-strategy §6; 测试/部署设计 §9.1, §9.4).
 *
 * Approved targets (all `requires-benchmark` — not verified guarantees until
 * production capacity evidence, ING-13): ingestion and platform-api each 99.9%
 * monthly availability; 95% of accepted events queryable within 60s and 99%
 * within 5min at normal capacity. 99.9% ≈ 43.8 error-budget minutes per month;
 * at 50% consumption, restrict risky non-essential releases; at exhaustion,
 * pause non-critical releases (测试/部署设计 §9.4).
 */

export interface SloDefinition {
  readonly id: string;
  /** Target as a fraction, e.g. 0.999 = 99.9%. */
  readonly target: number;
  /** Evaluation window in days (monthly = 30). */
  readonly windowDays: number;
  readonly numeratorMetric?: string;
  readonly denominatorMetric?: string;
  /** Capacity / measurement note (e.g. 'requires-benchmark'). */
  readonly note: string;
}

export const AURORA_SLOS: readonly SloDefinition[] = Object.freeze([
  {
    id: 'ingestion-availability',
    target: 0.999,
    windowDays: 30,
    numeratorMetric: 'Ingestion.SuccessfulRequests',
    denominatorMetric: 'Ingestion.Requests',
    note: 'approved target; requires-benchmark',
  },
  {
    id: 'platform-api-availability',
    target: 0.999,
    windowDays: 30,
    numeratorMetric: 'PlatformApi.SuccessfulRequests',
    denominatorMetric: 'PlatformApi.Requests',
    note: 'approved target; platform-api not yet real; requires-benchmark',
  },
  {
    id: 'processing-freshness-95-60s',
    target: 0.95,
    windowDays: 30,
    note: 'accepted events queryable within 60s at normal capacity; requires-benchmark',
  },
  {
    id: 'processing-freshness-99-5m',
    target: 0.99,
    windowDays: 30,
    note: 'accepted events queryable within 5min at normal capacity; requires-benchmark',
  },
]);

export function calculateErrorBudgetMs(slo: SloDefinition): number {
  return Math.floor((1 - slo.target) * slo.windowDays * 24 * 60 * 60 * 1000);
}

export function errorBudgetConsumedPercent(slo: SloDefinition, consumedMs: number): number {
  const budget = calculateErrorBudgetMs(slo);
  if (budget <= 0) throw new Error('ops_slo_invalid_budget');
  return Math.min(100, (consumedMs / budget) * 100);
}
