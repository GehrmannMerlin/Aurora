import { describe, expect, it } from 'vitest';
import { AURORA_BACKUP_POLICY, validateBackupPolicy } from '../../src/backup/backup-policy.js';

describe('backup policy', () => {
  it('freezes 35-day retention with PITR and daily cross-region copy', () => {
    expect(AURORA_BACKUP_POLICY.retentionDays).toBe(35);
    expect(AURORA_BACKUP_POLICY.pitr).toBe(true);
    expect(AURORA_BACKUP_POLICY.crossRegionCopy.enabled).toBe(true);
    expect(AURORA_BACKUP_POLICY.crossRegionCopy.cadence).toBe('daily');
  });

  it('declares approved RPO/RTO targets marked requires-benchmark', () => {
    expect(AURORA_BACKUP_POLICY.targets.singleRegionRpoSeconds).toBe(300); // RPO <= 5min
    expect(AURORA_BACKUP_POLICY.targets.singleRegionRtoSeconds).toBe(3600); // RTO <= 60min
    expect(AURORA_BACKUP_POLICY.targets.regionalRpoSeconds).toBe(86400); // RPO <= 24h
    expect(AURORA_BACKUP_POLICY.targets.regionalRtoSeconds).toBe(28800); // RTO <= 8h
    expect(AURORA_BACKUP_POLICY.note).toContain('requires-benchmark');
  });

  it('keeps cross-region copy honest: target requires-backup-account', () => {
    expect(AURORA_BACKUP_POLICY.note).toContain('requires-backup-account');
    expect(AURORA_BACKUP_POLICY.crossRegionCopy.targetRegion).toBeUndefined();
  });

  it('keeps RPO/RTO targets consistent with test-strategy §6 and 测试/部署设计 §11.1', () => {
    // single-region Multi-AZ: RPO <= 5min, RTO <= 60min
    expect(AURORA_BACKUP_POLICY.targets.singleRegionRpoSeconds).toBeLessThanOrEqual(300);
    expect(AURORA_BACKUP_POLICY.targets.singleRegionRtoSeconds).toBeLessThanOrEqual(3600);
    // regional: RPO <= 24h, RTO <= 8h
    expect(AURORA_BACKUP_POLICY.targets.regionalRpoSeconds).toBeLessThanOrEqual(86400);
    expect(AURORA_BACKUP_POLICY.targets.regionalRtoSeconds).toBeLessThanOrEqual(28800);
  });

  it('validates the frozen policy', () => {
    expect(validateBackupPolicy(AURORA_BACKUP_POLICY)).toEqual([]);
  });

  it('rejects a policy that disables PITR or shrinks retention below 35 days', () => {
    expect(validateBackupPolicy({ ...AURORA_BACKUP_POLICY, pitr: false })).toContain(
      'pitr-required',
    );
    expect(validateBackupPolicy({ ...AURORA_BACKUP_POLICY, retentionDays: 7 })).toContain(
      'retention-min',
    );
  });

  it('rejects a non-daily cross-region cadence or invalid targets', () => {
    expect(
      validateBackupPolicy({
        ...AURORA_BACKUP_POLICY,
        crossRegionCopy: { ...AURORA_BACKUP_POLICY.crossRegionCopy, cadence: 'weekly' },
      }),
    ).toContain('copy-cadence');
    expect(
      validateBackupPolicy({
        ...AURORA_BACKUP_POLICY,
        targets: { ...AURORA_BACKUP_POLICY.targets, singleRegionRtoSeconds: 0 },
      }),
    ).toContain('invalid-target:singleRegionRtoSeconds');
  });
});
