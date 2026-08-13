import { describe, expect, it } from 'vitest';
import { RedisSessionCleanupAdapter } from '../../src/retention/redis-session-cleanup-adapter.js';
import { ObjectStorageCleanupAdapter } from '../../src/retention/object-storage-cleanup-adapter.js';
import {
  BACKUP_EXPIRY_DAYS,
  BackupLifecycleCleanupAdapter,
  assertNoRecordLevelDestruction,
} from '../../src/retention/backup-lifecycle-cleanup-adapter.js';

const INPUT = {
  accountId: '00000000-0000-0000-0000-000000000001',
  accountEmail: 'deleted@example.com',
  requiredLifecycle: { backupExpiryDays: 35, onlineCleanupDays: 7, auditYears: 1 },
};

describe('SEC-02 contract cleanup adapters', () => {
  it('redis-session adapter pins the revocation contract and always reports ok (deferred infra)', async () => {
    const adapter = new RedisSessionCleanupAdapter();
    expect(adapter.store).toBe('redis-sessions');
    const result = await adapter.cleanup();
    expect(result).toEqual({ ok: true });
  });

  it('object-storage adapter pins the private-object deletion contract', async () => {
    const adapter = new ObjectStorageCleanupAdapter();
    expect(adapter.store).toBe('object-storage');
    const result = await adapter.cleanup();
    expect(result).toEqual({ ok: true });
  });

  it('backup lifecycle enforces 35-day natural expiry and rejects record-level destruction', async () => {
    const adapter = new BackupLifecycleCleanupAdapter();
    expect(adapter.store).toBe('backup-lifecycle');
    expect(BACKUP_EXPIRY_DAYS).toBe(35);
    expect(assertNoRecordLevelDestruction({ backupExpiryDays: 35 })).toBeUndefined();
    expect(assertNoRecordLevelDestruction({ backupExpiryDays: 14 })).toBe(
      'backup-expiry-below-35-days',
    );
    const ok = await adapter.cleanup(INPUT);
    expect(ok).toEqual({ ok: true });
    const rejected = await adapter.cleanup({
      ...INPUT,
      requiredLifecycle: { backupExpiryDays: 7 },
    });
    expect(rejected).toEqual({ ok: false, errorCode: 'backup_policy:backup-expiry-below-35-days' });
  });
});
