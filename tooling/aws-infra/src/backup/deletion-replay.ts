/**
 * OPS-07 deletion-replay contract (backup-and-recovery.md §5; A5 rules §6—11).
 *
 * After restoring from a recovery point that precedes a deletion/revocation,
 * the service must replay the deletion facts that occurred AFTER the recovery
 * point BEFORE it reopens to traffic: the account cannot log in, all old
 * sessions stay invalid, organization relations do not resurrect, direct
 * identity is re-deleted/anonymized, a same-email new account is not linked to
 * the old identity, and revoked ingestion credentials (ADR-013/014: revoked is
 * a permanent terminal state) must never be restored.
 *
 * Backup expiry: 35-day natural expiry; backups are not a read path for deleted
 * data and are never destroyed per-record inside a shared immutable backup.
 *
 * PREREQUISITE DEBT: SEC-02 (cross-store deletion propagation across
 * PostgreSQL/Redis/objects/audit/backup) is a G04 leaf that does NOT exist yet.
 * This is the one area OPS-07 is not allowed to fake-pass: delete-replay
 * acceptance stays `prerequisite-pending` until SEC-02 and the final deletion
 * model exist. This module implements the contract model + validation only.
 */

import type { BackupPolicy } from './backup-policy.js';

export type DeletionFactKind =
  | 'account-deletion'
  | 'session-revocation'
  | 'org-relation'
  | 'direct-identity'
  | 'same-email'
  | 'credential-revocation'
  | 'backup-expiry';

export interface DeletionReplayFact {
  readonly kind: DeletionFactKind;
  /** Must be replayed before the service reopens to traffic. */
  readonly replayBeforeOpen: boolean;
}

export interface DeletionReplayValidation {
  readonly violations: readonly string[];
  readonly prerequisiteDebt: readonly string[];
}

const MANDATORY_PRE_OPEN: readonly DeletionFactKind[] = [
  'account-deletion',
  'session-revocation',
  'org-relation',
  'direct-identity',
  'same-email',
  'credential-revocation',
];

export function validateDeletionReplay(
  facts: readonly DeletionReplayFact[],
  policy: BackupPolicy,
): DeletionReplayValidation {
  const violations: string[] = [];
  for (const kind of MANDATORY_PRE_OPEN) {
    const fact = facts.find((candidate) => candidate.kind === kind);
    if (fact === undefined) {
      violations.push(`${kind}-must-replay`);
    } else if (!fact.replayBeforeOpen) {
      violations.push(`${kind}-must-replay`);
    }
  }
  const expiry = facts.find((candidate) => candidate.kind === 'backup-expiry');
  if (expiry === undefined) {
    violations.push('backup-expiry-missing');
  } else if (expiry.replayBeforeOpen) {
    violations.push('backup-expiry-is-background-not-pre-open');
  }
  if (policy.retentionDays < 35) violations.push('backup-expiry-retention-min');
  if (!policy.pitr) violations.push('pitr-required-for-restore');

  // SEC-02 (cross-store deletion propagation) is a G04 leaf that does not exist
  // yet. Delete-replay acceptance stays prerequisite-pending — OPS-07 never
  // fakes cross-store deletion truth (user rule: the one thing OPS-07 cannot
  // fake-pass).
  const prerequisiteDebt: readonly string[] = ['sec-02-cross-store-deletion-pending'];
  return Object.freeze({
    violations: Object.freeze(violations),
    prerequisiteDebt: Object.freeze(prerequisiteDebt),
  });
}
