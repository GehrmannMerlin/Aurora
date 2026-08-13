/**
 * SEC-02 restore-after-delete replay contract (account-deletion-and-data-lifecycle §9;
 * backup-and-recovery §5).
 *
 * After restoring from a recovery point that precedes a deletion, the service
 * must replay the deletion facts that occurred AFTER the recovery point BEFORE
 * it reopens to traffic: the account cannot log in, all old sessions stay
 * invalid, organization relations do not resurrect, direct identity is
 * re-deleted/anonymized, a same-email new account is not linked to the old
 * identity, and revoked credentials never revive.
 *
 * This pure contract aligns with OPS-07 `validateDeletionReplay`: the pre-open
 * mandatory facts are checked here so SEC-02 and OPS-07 agree on the
 * no-resurrection guarantee.
 */

export type DeleteReplayFact =
  | 'account-deletion'
  | 'session-revocation'
  | 'org-relation'
  | 'direct-identity'
  | 'same-email'
  | 'credential-revocation';

const MANDATORY_PRE_OPEN: readonly DeleteReplayFact[] = [
  'account-deletion',
  'session-revocation',
  'org-relation',
  'direct-identity',
  'same-email',
  'credential-revocation',
];

/** Returns violations; empty array = the replay plan is safe to open traffic. */
export function validateDeleteReplayFacts(facts: readonly DeleteReplayFact[]): readonly string[] {
  const present = new Set(facts);
  return Object.freeze(
    MANDATORY_PRE_OPEN.filter((fact) => !present.has(fact)).map((fact) => `${fact}-must-replay`),
  );
}
