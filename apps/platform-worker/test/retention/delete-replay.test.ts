import { describe, expect, it } from 'vitest';
import { validateDeleteReplayFacts, type DeleteReplayFact } from '../../src/retention/delete-replay.js';

const COMPLETE: readonly DeleteReplayFact[] = [
  'account-deletion',
  'session-revocation',
  'org-relation',
  'direct-identity',
  'same-email',
  'credential-revocation',
];

describe('SEC-02 restore delete-replay contract', () => {
  it('accepts a replay plan that replays every mandatory pre-open fact', () => {
    expect(validateDeleteReplayFacts(COMPLETE)).toEqual([]);
  });

  it('rejects a plan that would resurrect revoked credentials', () => {
    const missing = COMPLETE.filter((fact) => fact !== 'credential-revocation');
    expect(validateDeleteReplayFacts(missing)).toContain('credential-revocation-must-replay');
  });

  it('rejects a plan that omits account-deletion or session-revocation', () => {
    const noSession = COMPLETE.filter((fact) => fact !== 'session-revocation');
    expect(validateDeleteReplayFacts(noSession)).toContain('session-revocation-must-replay');
    const noAccount = COMPLETE.filter((fact) => fact !== 'account-deletion');
    expect(validateDeleteReplayFacts(noAccount)).toContain('account-deletion-must-replay');
  });

  it('requires every mandatory fact before the service reopens', () => {
    expect(validateDeleteReplayFacts([])).toEqual([
      'account-deletion-must-replay',
      'session-revocation-must-replay',
      'org-relation-must-replay',
      'direct-identity-must-replay',
      'same-email-must-replay',
      'credential-revocation-must-replay',
    ]);
  });
});
