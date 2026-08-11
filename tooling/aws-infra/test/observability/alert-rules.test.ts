import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_ALERT_RULES,
  validateOperationalAlertRules,
  type OperationalAlertRule,
} from '../../src/observability/alert-rules.js';

describe('operational alert rules', () => {
  it('declares a unique rule set with valid metadata', () => {
    const violations = validateOperationalAlertRules(OPERATIONAL_ALERT_RULES);
    expect(violations).toEqual([]);
  });

  it('covers the required platform-run signals', () => {
    const ids = OPERATIONAL_ALERT_RULES.map((rule) => rule.id);
    expect(ids).toContain('ops-ingestion-availability');
    expect(ids).toContain('ops-ingestion-error-rate');
    expect(ids).toContain('ops-processing-lag');
    expect(ids).toContain('ops-processing-dead-letter');
    expect(ids).toContain('ops-db-cpu');
    expect(ids).toContain('ops-db-storage');
    expect(ids).toContain('ops-db-connections');
    expect(ids).toContain('ops-worker-restarts');
    expect(ids).toContain('ops-worker-down');
    expect(ids).toContain('ops-deployment-failure');
  });

  it('never allows a product alert into the operational alert model', () => {
    const base = rule('ops-ingestion-error-rate');
    const productRule = { ...base, id: 'product-issue-spike', productAlert: true };
    const violations = validateOperationalAlertRules([...OPERATIONAL_ALERT_RULES, productRule]);
    expect(violations).toContain('product-alert-forbidden:product-issue-spike');
  });

  it('flags duplicate ids, bad operators and invalid runbook refs', () => {
    const base = rule('ops-ingestion-error-rate');
    const violations = validateOperationalAlertRules([base, base]);
    expect(violations).toContain('duplicate-id:ops-ingestion-error-rate');
    const badOperator = { ...base, comparisonOperator: 'GreaterThanUnknown' };
    expect(validateOperationalAlertRules([badOperator])).toContain(
      'invalid-operator:ops-ingestion-error-rate',
    );
    const badRunbook = { ...base, runbook: 'README.md' };
    expect(validateOperationalAlertRules([badRunbook])).toContain(
      'invalid-runbook-ref:ops-ingestion-error-rate',
    );
  });

  it('keeps a P0 for deployment failures (data/user impact)', () => {
    const deployment = OPERATIONAL_ALERT_RULES.find(
      (candidate) => candidate.id === 'ops-deployment-failure',
    );
    expect(deployment?.severity).toBe('P0');
    expect(deployment?.runbook).toContain('worker-and-deployment-failure.md');
  });
});

function rule(id: string): OperationalAlertRule {
  const found = OPERATIONAL_ALERT_RULES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing rule ${id}`);
  return found;
}
