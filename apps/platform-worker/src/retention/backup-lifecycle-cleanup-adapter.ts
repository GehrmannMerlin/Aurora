/**
 * SEC-02 backup lifecycle cleanup adapter — CONTRACT implementation.
 *
 * Per account-deletion-and-data-lifecycle §9: shared immutable backups are
 * NEVER modified per-record (no integrity-destroying record edits); backups
 * containing pre-deletion account data expire naturally within 35 days; backups
 * are not a read path for deleted data and cannot resurrect a deleted account.
 * The concrete RDS snapshot/object-version lifecycle is wired in the backup
 * runtime (OPS-07 / requires-backup-account); this adapter pins the policy.
 */

import type { CleanupAdapter, CleanupInput, CleanupResult } from './cleanup-adapters.js';

export const BACKUP_EXPIRY_DAYS = 35;

export function assertNoRecordLevelDestruction(requiredLifecycle: unknown): string | undefined {
  const lifecycle = requiredLifecycle as { backupExpiryDays?: unknown } | null;
  const expiryDays = lifecycle?.backupExpiryDays;
  if (typeof expiryDays === 'number' && expiryDays < BACKUP_EXPIRY_DAYS) {
    return 'backup-expiry-below-35-days';
  }
  return undefined;
}

export class BackupLifecycleCleanupAdapter implements CleanupAdapter {
  readonly store = 'backup-lifecycle' as const;

  cleanup(input: CleanupInput): Promise<CleanupResult> {
    const violation = assertNoRecordLevelDestruction(input.requiredLifecycle);
    if (violation !== undefined) {
      return Promise.resolve({ ok: false, errorCode: `backup_policy:${violation}` });
    }
    // Contract-only: shared immutable backups expire naturally; no per-record edit.
    return Promise.resolve({ ok: true });
  }
}
