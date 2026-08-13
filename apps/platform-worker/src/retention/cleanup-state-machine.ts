/**
 * SEC-02 deletion state machine (account-deletion-and-data-lifecycle §8).
 *
 * Pure functions — no I/O. Models the cross-store cleanup of a durable deletion
 * intent (`account_cleanup_handoffs`, SEC-01): a fixed store order, per-step
 * attempt outcomes, and the handoff-level outcome (succeeded / retry /
 * dead_lettered). Idempotency is expressed via `isStepEligibleForRun`: a step
 * that already succeeded is never re-run. A handoff only reaches `succeeded`
 * when EVERY required store step succeeded — partial success is never reported
 * as complete (§8: cross-system confirmation is required before "deleted").
 */

export type CleanupStoreId =
  'postgres' | 'redis-sessions' | 'object-storage' | 'audit' | 'backup-lifecycle';

export interface CleanupStep {
  readonly store: CleanupStoreId;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly errorCode?: string;
  readonly attemptCount: number;
}

const CLEANUP_STORE_ORDER: readonly CleanupStoreId[] = [
  'postgres',
  'redis-sessions',
  'object-storage',
  'backup-lifecycle',
  'audit',
];

/** Fixed store order: identity/memberships first, then sessions/objects, then audit/backup. */
export function decideCleanupStores(): readonly CleanupStoreId[] {
  return Object.freeze([...CLEANUP_STORE_ORDER]);
}

export function decideStepAfterAttempt(
  step: CleanupStep,
  ok: boolean,
  errorCode: string | undefined,
): CleanupStep {
  if (ok) {
    return Object.freeze({
      store: step.store,
      status: 'succeeded',
      attemptCount: step.attemptCount + 1,
    });
  }
  return Object.freeze({
    store: step.store,
    status: 'failed',
    ...(errorCode === undefined ? {} : { errorCode }),
    attemptCount: step.attemptCount + 1,
  });
}

export function isStepEligibleForRun(step: CleanupStep): boolean {
  return step.status !== 'succeeded';
}

export function decideHandoffOutcome(
  steps: readonly CleanupStep[],
  attemptCount: number,
  maxAttempts: number,
): 'succeeded' | 'retry' | 'dead_lettered' {
  const allSucceeded = steps.length > 0 && steps.every((step) => step.status === 'succeeded');
  if (allSucceeded) return 'succeeded';
  if (attemptCount >= maxAttempts) return 'dead_lettered';
  return 'retry';
}
