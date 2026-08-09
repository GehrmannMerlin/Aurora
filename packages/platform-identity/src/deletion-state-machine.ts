/**
 * SEC-01 authoritative account-deletion finalization decision (spec §4.2).
 *
 * Pure function: no I/O, no `Date.now()` — the caller injects `now` so tests
 * can drive the 168h boundary with a fake clock and so the future SEC-02
 * worker can reuse the same decision as its production trigger.
 */

export type DeletionFinalizationDecision = 'finalize' | 'keep_cooling' | 'not_due';

export interface DecideDeletionFinalizationInput {
  readonly status: string;
  /** Accounts.deletion_cooling_ends_at as an ISO-8601 UTC string. */
  readonly deletionCoolingEndsAt: string | null;
  /** Server-authoritative current time (never client time). */
  readonly now: Date;
  /** True when the final unique-owner re-check failed for this account. */
  readonly ownerBlocked: boolean;
}

/**
 * Decide whether a `deletion_cooling` account may cross the irreversible
 * boundary into `terminated`:
 * - `not_due` — not in cooling, or no cooling deadline recorded, or the
 *   deadline has not been reached yet (`now < coolingEndsAt`);
 * - `finalize` — cooling deadline reached (`coolingEndsAt <= now`) and the
 *   final owner re-check passed;
 * - `keep_cooling` — cooling deadline reached but the owner re-check failed:
 *   do NOT advance; the account stays frozen and the cancel flow stays usable.
 */
export function decideDeletionFinalization(
  input: DecideDeletionFinalizationInput,
): DeletionFinalizationDecision {
  const { status, deletionCoolingEndsAt, now, ownerBlocked } = input;
  if (status !== 'deletion_cooling' || deletionCoolingEndsAt === null) return 'not_due';
  if (now.getTime() < new Date(deletionCoolingEndsAt).getTime()) return 'not_due';
  return ownerBlocked ? 'keep_cooling' : 'finalize';
}
