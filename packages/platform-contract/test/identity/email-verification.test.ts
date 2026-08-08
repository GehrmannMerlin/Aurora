import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CONFIRM_EMAIL_VERIFICATION,
  identityConfirmEmailVerificationRequest,
  identityConfirmEmailVerificationResponse,
} from '../../src/identity/email-verification.js';

describe('identityConfirmEmailVerification contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_CONFIRM_EMAIL_VERIFICATION).toBe('identityConfirmEmailVerification');
  });

  it('accepts a valid confirm request', () => {
    expect(
      identityConfirmEmailVerificationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing idempotencyKey', () => {
    expect(identityConfirmEmailVerificationRequest.zod.safeParse({}).success).toBe(false);
  });

  it('rejects an undeclared field (closed object)', () => {
    expect(
      identityConfirmEmailVerificationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
        token: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid confirm response without secrets', () => {
    expect(
      identityConfirmEmailVerificationResponse.zod.safeParse({
        verificationStatus: { verified: true },
        account: { accountId: 'acct_1', email: 'user@example.invalid', verified: true },
      }).success,
    ).toBe(true);
  });

  it('rejects a response leaking passwordHash or token', () => {
    expect(
      identityConfirmEmailVerificationResponse.zod.safeParse({
        verificationStatus: { verified: true },
        account: {
          accountId: 'acct_1',
          email: 'user@example.invalid',
          verified: true,
          passwordHash: 'x',
        },
        token: 't_1',
      }).success,
    ).toBe(false);
  });
});
