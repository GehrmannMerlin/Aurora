/**
 * OPS-05 rollback planner (release-migration-and-rollback.md §4).
 *
 * Rollback is per rollback unit — SPA entry, API service, Worker service — and
 * never rolls the database back destructively. The planner compares the current
 * manifest against the previous (pre-deployment) manifest and produces:
 *
 * - one `ServiceRollback` per service whose image digest moved forward,
 *   pointing back at the previous digest;
 * - a `revertSpaEntry` back to the previous SPA content-hash prefix when the
 *   console entry hash changed;
 * - `workerPause` when a Worker digest is being reverted (the rollout drains
 *   the worker before reverting, then resumes; reliably-received facts are
 *   never dropped — they resume via lease/idempotency).
 *
 * `assertNoDestructiveMigrationRollback` guards that a rollback plan never
 * includes a destructive database step: rollbacks are forward-fix/compatible
 * (Release §3—4).
 */

import type { ReleaseManifest } from './manifest.js';

export interface ServiceRollback {
  readonly service: string;
  readonly previousDigest: string;
}

export interface RollbackPlan {
  readonly serviceRollbacks: readonly ServiceRollback[];
  readonly revertSpaEntry?: string;
  readonly workerPause: boolean;
  readonly note: string;
}

const FORWARD_COMPAT_NOTE =
  'rollback reverts application digests and SPA entry only; no destructive DB migration is run (expand/contract, Release §3—4)';

export function planRollback(current: ReleaseManifest, previous: ReleaseManifest): RollbackPlan {
  const serviceRollbacks: ServiceRollback[] = [];
  for (const [service, currentRef] of Object.entries(current.artifacts)) {
    const previousDigest = previous.artifacts[service]?.imageDigest;
    if (previousDigest !== undefined && currentRef.imageDigest !== previousDigest) {
      serviceRollbacks.push({ service, previousDigest });
    }
  }
  const currentSpa = current.artifacts.console?.entryAssetHash;
  const previousSpa = previous.artifacts.console?.entryAssetHash;
  const revertSpaEntry =
    currentSpa !== undefined && previousSpa !== undefined && currentSpa !== previousSpa
      ? previousSpa
      : undefined;
  return Object.freeze({
    serviceRollbacks: Object.freeze(serviceRollbacks),
    ...(revertSpaEntry === undefined ? {} : { revertSpaEntry }),
    workerPause: serviceRollbacks.some((rollback) => rollback.service === 'ingestion-worker'),
    note: FORWARD_COMPAT_NOTE,
  });
}

export function assertNoDestructiveMigrationRollback(plan: RollbackPlan): void {
  if (plan.note !== FORWARD_COMPAT_NOTE) {
    throw new Error('unsafe_rollback: rollback plan must not include destructive DB steps');
  }
}
