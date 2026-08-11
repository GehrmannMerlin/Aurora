import { describe, expect, it } from 'vitest';
import { AURORA_BACKUP_POLICY } from '../../src/backup/backup-policy.js';
import { validateDeletionReplay } from '../../src/backup/deletion-replay.js';

const COMPLETE_PRE_OPEN = [
  { kind: 'account-deletion', replayBeforeOpen: true },
  { kind: 'session-revocation', replayBeforeOpen: true },
  { kind: 'org-relation', replayBeforeOpen: true },
  { kind: 'direct-identity', replayBeforeOpen: true },
  { kind: 'same-email', replayBeforeOpen: true },
  { kind: 'credential-revocation', replayBeforeOpen: true },
  { kind: 'backup-expiry', replayBeforeOpen: false },
] as const;

describe('deletion replay contract', () => {
  it('marks delete-replay acceptance as prerequisite-pending until SEC-02 exists', () => {
    const result = validateDeletionReplay([], AURORA_BACKUP_POLICY);
    expect(result.prerequisiteDebt).toContain('sec-02-cross-store-deletion-pending');
  });

  it('accepts a complete pre-open replay plan with background backup expiry', () => {
    const result = validateDeletionReplay(COMPLETE_PRE_OPEN, AURORA_BACKUP_POLICY);
    expect(result.violations).toEqual([]);
  });

  it('rejects a replay plan that would resurrect revoked credentials or deleted data', () => {
    const facts = COMPLETE_PRE_OPEN.filter((fact) => fact.kind !== 'credential-revocation');
    const result = validateDeletionReplay(facts, AURORA_BACKUP_POLICY);
    expect(result.violations).toContain('credential-revocation-must-replay');
  });

  it('rejects a replay plan that defers account-deletion or session revocation to post-open', () => {
    const facts = COMPLETE_PRE_OPEN.map((fact) =>
      fact.kind === 'account-deletion' || fact.kind === 'session-revocation'
        ? { ...fact, replayBeforeOpen: false }
        : fact,
    );
    const result = validateDeletionReplay(facts, AURORA_BACKUP_POLICY);
    expect(result.violations).toContain('account-deletion-must-replay');
    expect(result.violations).toContain('session-revocation-must-replay');
  });

  it('enforces 35-day backup expiry without record-level pre-open destruction', () => {
    const noExpiry = COMPLETE_PRE_OPEN.filter((fact) => fact.kind !== 'backup-expiry');
    expect(validateDeletionReplay(noExpiry, AURORA_BACKUP_POLICY).violations).toContain(
      'backup-expiry-missing',
    );
    const prematureExpiry = COMPLETE_PRE_OPEN.map((fact) =>
      fact.kind === 'backup-expiry' ? { ...fact, replayBeforeOpen: true } : fact,
    );
    expect(validateDeletionReplay(prematureExpiry, AURORA_BACKUP_POLICY).violations).toContain(
      'backup-expiry-is-background-not-pre-open',
    );
  });

  it('enforces PITR for any restore that must replay deletions', () => {
    const result = validateDeletionReplay(COMPLETE_PRE_OPEN, {
      ...AURORA_BACKUP_POLICY,
      pitr: false,
    });
    expect(result.violations).toContain('pitr-required-for-restore');
  });
});
