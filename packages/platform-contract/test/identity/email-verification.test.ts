import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CONFIRM_EMAIL_VERIFICATION,
  OPERATION_ID_RESEND_EMAIL_VERIFICATION,
  identityConfirmEmailVerificationRequest,
  identityConfirmEmailVerificationResponse,
  identityResendEmailVerificationRequest,
  identityResendEmailVerificationResponse,
} from '../../src/identity/email-verification.js';
import { PLATFORM_OPERATIONS } from '../../src/registry/operations.js';

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

describe('identityResendEmailVerification contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_RESEND_EMAIL_VERIFICATION).toBe('identityResendEmailVerification');
  });

  it('accepts only an idempotency key and never a client-supplied email', () => {
    expect(
      identityResendEmailVerificationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
    expect(
      identityResendEmailVerificationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
        email: 'attacker@example.invalid',
      }).success,
    ).toBe(false);
    expect(
      identityResendEmailVerificationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('requires the queued delivery projection and resend timing', () => {
    const valid = {
      emailMasked: 'u***@example.invalid',
      deliveryStatus: 'queued',
      resendAvailableAt: '2026-08-14T01:01:00.000Z',
      serverTime: '2026-08-14T01:00:00.000Z',
    };
    expect(identityResendEmailVerificationResponse.zod.safeParse(valid).success).toBe(true);

    for (const requiredField of Object.keys(valid)) {
      const incomplete = Object.fromEntries(
        Object.entries(valid).filter(([field]) => field !== requiredField),
      );
      expect(
        identityResendEmailVerificationResponse.zod.safeParse(incomplete).success,
        requiredField,
      ).toBe(false);
    }
  });

  it('registers a session-authenticated CSRF-protected idempotent POST command', () => {
    const operation = PLATFORM_OPERATIONS.find(
      (candidate) => candidate.operationId === OPERATION_ID_RESEND_EMAIL_VERIFICATION,
    );

    expect(operation).toMatchObject({
      method: 'POST',
      path: '/api/platform/v1/auth/email/resend',
      authLevel: 'session',
      request: { csrf: true, idempotency: true },
    });
    expect(operation?.errorCodes).toContain('state_machine_conflict');
  });
});
