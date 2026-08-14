import { describe, expect, it } from 'vitest';
import { identityGetSessionResponse } from '../../src/identity/session.js';

describe('identityGetSession', () => {
  it('accepts a valid session projection', () => {
    expect(
      identityGetSessionResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', emailMasked: 'a***@b.c', verified: true },
        authentication: 'authenticated',
        session: { expiresAt: '2026-08-08T01:00:00.000Z' },
        csrf: 'tok',
        navigation: [],
      }).success,
    ).toBe(true);
  });

  it('requires the server-produced masked email projection', () => {
    expect(
      identityGetSessionResponse.zod.safeParse({
        account: { accountId: 'acct_1', email: 'a@b.c', verified: false },
        authentication: 'pending_verification',
        session: { expiresAt: '2026-08-08T01:00:00.000Z' },
        csrf: 'tok',
        navigation: [],
      }).success,
    ).toBe(false);
  });

  it('rejects a leaked session id or password field', () => {
    expect(
      identityGetSessionResponse.zod.safeParse({
        account: {
          accountId: 'acct_1',
          email: 'a@b.c',
          emailMasked: 'a***@b.c',
          verified: true,
          passwordHash: 'x',
        },
        authentication: 'authenticated',
        session: { expiresAt: '2026-08-08T01:00:00.000Z', sessionId: 's_1' },
        csrf: 'tok',
        navigation: [],
      }).success,
    ).toBe(false);
  });
});
