import { describe, expect, it } from 'vitest';
import { assertRestoreSafety, planRestoreOrder } from '../../src/backup/restore-order.js';

describe('restore orchestration', () => {
  it('orders restore per backup-and-recovery §6', () => {
    const plan = planRestoreOrder();
    expect(plan.steps.map((step) => step.phase)).toEqual([
      'infra-keys',
      'postgres-migrations',
      'session-task-state',
      'private-objects',
      'outbox-resume',
      'deletion-replay',
      'query-command-verify',
      'readonly-verify',
      'controlled-traffic',
    ]);
  });

  it('asserts restore cannot resurrect deleted/revoked/session state', () => {
    const plan = planRestoreOrder();
    expect(assertRestoreSafety(plan)).toEqual([]);
  });

  it('flags a scrambled order that opens traffic before deletion replay', () => {
    const plan = planRestoreOrder();
    const scrambled = { ...plan, steps: Object.freeze([...plan.steps].reverse()) };
    const violations = assertRestoreSafety(scrambled);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('flags a plan that omits the deletion-replay phase', () => {
    const plan = planRestoreOrder();
    const withoutReplay = {
      ...plan,
      steps: Object.freeze(plan.steps.filter((step) => step.phase !== 'deletion-replay')),
    };
    expect(assertRestoreSafety(withoutReplay)).toContain('deletion-replay-required');
  });
});
