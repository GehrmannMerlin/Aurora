/** Claimable states are the ones a normal worker may pick up. */
export const CLAIMABLE_STATES = ['pending', 'retry_waiting'] as const;

export type ClaimableState = (typeof CLAIMABLE_STATES)[number];

/**
 * Where clause for records a normal consumer may claim: pending or
 * retry_waiting, and only once available_at has passed. Processed and
 * dead-lettered records never match; leased records must be reclaimed by
 * explicit lease-expiry logic, not by this predicate.
 */
export function claimableWhereClause(): string {
  return `state IN ('pending','retry_waiting') AND available_at <= now()`;
}

/** Records whose lease has expired (reclaimable by a worker). */
export function expiredLeaseWhereClause(): string {
  return `state = 'leased' AND lease_expires_at < now()`;
}
