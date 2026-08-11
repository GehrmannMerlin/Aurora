import { describe, expect, it } from 'vitest';
import {
  AURORA_SLOS,
  calculateErrorBudgetMs,
  errorBudgetConsumedPercent,
} from '../../src/observability/slo.js';

describe('SLO definitions', () => {
  it('covers ingestion/platform-api availability and processing freshness targets', () => {
    const ids = AURORA_SLOS.map((slo) => slo.id);
    expect(ids).toContain('ingestion-availability');
    expect(ids).toContain('platform-api-availability');
    expect(ids).toContain('processing-freshness-95-60s');
    expect(ids).toContain('processing-freshness-99-5m');
  });

  it('marks targets as requires-benchmark (not verified guarantees)', () => {
    for (const slo of AURORA_SLOS) {
      expect(slo.note).toContain('requires-benchmark');
    }
  });
});

describe('error budget math', () => {
  it('99.9% monthly target yields ~43.8 error-budget minutes', () => {
    const slo = AURORA_SLOS.find((s) => s.id === 'ingestion-availability');
    if (slo === undefined) throw new Error('missing slo');
    const budgetMinutes = calculateErrorBudgetMs(slo) / 60000;
    expect(budgetMinutes).toBeGreaterThan(43);
    expect(budgetMinutes).toBeLessThan(44);
  });

  it('reports consumed percent capped at 100', () => {
    const slo = AURORA_SLOS.find((s) => s.id === 'ingestion-availability');
    if (slo === undefined) throw new Error('missing slo');
    const budgetMs = calculateErrorBudgetMs(slo);
    expect(errorBudgetConsumedPercent(slo, budgetMs / 2)).toBeCloseTo(50, 5);
    expect(errorBudgetConsumedPercent(slo, budgetMs * 10)).toBe(100);
  });

  it('throws on an invalid (zero) budget', () => {
    expect(() =>
      errorBudgetConsumedPercent({ id: 'x', target: 1, windowDays: 30, note: '' }, 1),
    ).toThrow('ops_slo_invalid_budget');
  });
});
