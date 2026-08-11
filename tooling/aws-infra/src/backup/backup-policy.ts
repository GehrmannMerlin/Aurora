/**
 * OPS-07 backup policy (backup-and-recovery.md §2; 测试/部署设计 §11.1).
 *
 * Pure contract module — no AWS calls. Freezes the approved backup policy:
 * production RDS automated backup 35 days + PITR + deletion protection (already
 * in DataStack, OPS-04); daily encrypted recovery-point copy to an isolated
 * backup account / second region (`requires-backup-account` — the topology is a
 * user-owned decision); single-region RPO ≤ 5min / RTO ≤ 60min and regional
 * RPO ≤ 24h / RTO ≤ 8h — approved targets, `requires-benchmark`, not verified
 * guarantees until production capacity/DR evidence (ING-13, OPS-07 drill).
 */

export interface BackupPolicy {
  /** RDS automated backup retention in days (min 35). */
  readonly retentionDays: number;
  /** Point-in-time recovery must be enabled. */
  readonly pitr: boolean;
  readonly crossRegionCopy: {
    readonly enabled: boolean;
    /** Widened so `validateBackupPolicy` can guard a hostile input at runtime. */
    readonly cadence: string;
    /** User-provided backup account region; undefined until provisioned. */
    readonly targetRegion: string | undefined;
    /** KMS key ref for cross-region copy encryption; undefined until provisioned. */
    readonly encryptionKmsKeyRef: string | undefined;
  };
  readonly targets: {
    /** Single-region Multi-AZ failure RPO (seconds). */
    readonly singleRegionRpoSeconds: number;
    /** Single-region Multi-AZ failure RTO (seconds). */
    readonly singleRegionRtoSeconds: number;
    /** Regional disaster RPO (seconds). */
    readonly regionalRpoSeconds: number;
    /** Regional disaster RTO (seconds). */
    readonly regionalRtoSeconds: number;
  };
  readonly note: string;
}

export const AURORA_BACKUP_POLICY: BackupPolicy = Object.freeze({
  retentionDays: 35,
  pitr: true,
  crossRegionCopy: Object.freeze({
    enabled: true,
    cadence: 'daily',
    targetRegion: undefined,
    encryptionKmsKeyRef: undefined,
  }),
  targets: Object.freeze({
    singleRegionRpoSeconds: 300, // RPO <= 5 min
    singleRegionRtoSeconds: 3600, // RTO <= 60 min
    regionalRpoSeconds: 86400, // RPO <= 24 h
    regionalRtoSeconds: 28800, // RTO <= 8 h
  }),
  note: 'approved targets; requires-benchmark; cross-region copy requires-backup-account',
});

export function validateBackupPolicy(policy: BackupPolicy): readonly string[] {
  const violations: string[] = [];
  if (!policy.pitr) violations.push('pitr-required');
  if (policy.retentionDays < 35) violations.push('retention-min');
  if (policy.crossRegionCopy.enabled && policy.crossRegionCopy.cadence !== 'daily') {
    violations.push('copy-cadence');
  }
  const targets = policy.targets;
  for (const [name, value] of Object.entries(targets)) {
    if (!Number.isFinite(value) || value <= 0) violations.push(`invalid-target:${name}`);
  }
  return Object.freeze(violations);
}
