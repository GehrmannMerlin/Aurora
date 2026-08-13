import { describe, expect, it } from 'vitest';
import {
  decideCleanupStores,
  decideHandoffOutcome,
  decideStepAfterAttempt,
  isStepEligibleForRun,
  type CleanupStep,
} from '../../src/retention/cleanup-state-machine.js';

const pendingSteps: readonly [CleanupStep, CleanupStep, CleanupStep, CleanupStep, CleanupStep] = [
  { store: 'postgres', status: 'pending', attemptCount: 0 },
  { store: 'redis-sessions', status: 'pending', attemptCount: 0 },
  { store: 'object-storage', status: 'pending', attemptCount: 0 },
  { store: 'audit', status: 'pending', attemptCount: 0 },
  { store: 'backup-lifecycle', status: 'pending', attemptCount: 0 },
];

describe('SEC-02 cleanup state machine', () => {
  it('decides the fixed cross-store order (postgres first, audit records completion last)', () => {
    expect(decideCleanupStores()).toEqual([
      'postgres',
      'redis-sessions',
      'object-storage',
      'backup-lifecycle',
      'audit',
    ]);
  });

  it('marks a successful step as succeeded and a failed step as failed with errorCode', () => {
    const okStep = decideStepAfterAttempt(pendingSteps[0], true, undefined);
    expect(okStep.status).toBe('succeeded');
    expect(okStep.attemptCount).toBe(1);
    const failStep = decideStepAfterAttempt(pendingSteps[0], false, 'postgres_cleanup_failed');
    expect(failStep.status).toBe('failed');
    expect(failStep.errorCode).toBe('postgres_cleanup_failed');
    expect(failStep.attemptCount).toBe(1);
  });

  it('never re-runs a step that already succeeded (idempotency)', () => {
    const done: CleanupStep = { store: 'postgres', status: 'succeeded', attemptCount: 1 };
    expect(isStepEligibleForRun(done)).toBe(false);
    expect(isStepEligibleForRun(pendingSteps[0])).toBe(true);
  });

  it('only reports succeeded when every required step succeeded', () => {
    const allDone: readonly CleanupStep[] = pendingSteps.map((step) => ({
      store: step.store,
      status: 'succeeded',
      attemptCount: 1,
    }));
    expect(decideHandoffOutcome(allDone, 1, 5)).toBe('succeeded');
  });

  it('returns retry on partial failure within budget and dead_lettered past budget', () => {
    const partial: readonly CleanupStep[] = pendingSteps.map((step, index) =>
      index === 0 ? { store: 'postgres', status: 'failed', errorCode: 'x', attemptCount: 1 } : step,
    );
    expect(decideHandoffOutcome(partial, 1, 5)).toBe('retry');
    expect(decideHandoffOutcome(partial, 5, 5)).toBe('dead_lettered');
  });
});
