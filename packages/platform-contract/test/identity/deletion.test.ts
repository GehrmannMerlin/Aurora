import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CANCEL_ACCOUNT_DELETION,
  OPERATION_ID_CANCEL_ACCOUNT_DELETION_INTENT_LINK,
  OPERATION_ID_DELETE_ACCOUNT,
  OPERATION_ID_DELETE_ACCOUNT_INTENT_LINK,
  OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT,
  OPERATION_ID_REQUEST_ACCOUNT_DELETION,
  identityCancelAccountDeletionIntentLinkPathParams,
  identityCancelAccountDeletionIntentLinkResponse,
  identityCancelAccountDeletionRequest,
  identityCancelAccountDeletionResponse,
  identityDeleteAccountIntentLinkPathParams,
  identityDeleteAccountIntentLinkResponse,
  identityDeleteAccountPreflightResponse,
  identityDeleteAccountRequest,
  identityDeleteAccountResponse,
  identityRequestAccountDeletionRequest,
  identityRequestAccountDeletionResponse,
} from '../../src/identity/deletion.js';

const UTC = '2026-08-09T01:00:00.000Z';

describe('account deletion contract', () => {
  it('has the frozen operation ids', () => {
    expect(OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT).toBe('identityDeleteAccountPreflight');
    expect(OPERATION_ID_REQUEST_ACCOUNT_DELETION).toBe('identityRequestAccountDeletion');
    expect(OPERATION_ID_DELETE_ACCOUNT).toBe('identityDeleteAccount');
    expect(OPERATION_ID_CANCEL_ACCOUNT_DELETION).toBe('identityCancelAccountDeletion');
    expect(OPERATION_ID_DELETE_ACCOUNT_INTENT_LINK).toBe('identityDeleteAccountIntentLink');
    expect(OPERATION_ID_CANCEL_ACCOUNT_DELETION_INTENT_LINK).toBe(
      'identityCancelAccountDeletionIntentLink',
    );
  });

  it('accepts a valid request-account-deletion request', () => {
    expect(
      identityRequestAccountDeletionRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing idempotencyKey on request-account-deletion', () => {
    expect(identityRequestAccountDeletionRequest.zod.safeParse({}).success).toBe(false);
  });

  it('rejects an undeclared field on request-account-deletion request (closed object)', () => {
    expect(
      identityRequestAccountDeletionRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
        email: 'a@example.com',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid request-account-deletion response', () => {
    expect(
      identityRequestAccountDeletionResponse.zod.safeParse({
        status: 'succeeded',
        maskedEmail: 'us**@example.invalid',
        resendAvailableAt: UTC,
      }).success,
    ).toBe(true);
  });

  it('accepts a request-account-deletion response without resendAvailableAt', () => {
    expect(
      identityRequestAccountDeletionResponse.zod.safeParse({
        status: 'succeeded',
        maskedEmail: 'us**@example.invalid',
      }).success,
    ).toBe(true);
  });

  it('rejects a request-account-deletion response with a non-succeeded status', () => {
    expect(
      identityRequestAccountDeletionResponse.zod.safeParse({
        status: 'pending',
        maskedEmail: 'us**@example.invalid',
      }).success,
    ).toBe(false);
  });

  it('rejects a request-account-deletion response leaking the full email (closed object)', () => {
    expect(
      identityRequestAccountDeletionResponse.zod.safeParse({
        status: 'succeeded',
        maskedEmail: 'user@example.invalid',
        fullEmail: 'user@example.invalid',
      }).success,
    ).toBe(false);
  });

  it('rejects a request-account-deletion response with an unmasked email', () => {
    expect(
      identityRequestAccountDeletionResponse.zod.safeParse({
        status: 'succeeded',
        maskedEmail: 'ab', // str(3, 320): the mask is always at least 3 chars
        resendAvailableAt: UTC,
      }).success,
    ).toBe(false);
  });

  it('accepts a ready preflight response without blockers', () => {
    expect(
      identityDeleteAccountPreflightResponse.zod.safeParse({
        status: 'ready',
        requiredLifecycle: {
          coolingHours: 168,
          onlineCleanupDays: 7,
          auditRetentionYears: 1,
          backupRetentionDays: 35,
        },
        serverTime: UTC,
      }).success,
    ).toBe(true);
  });

  it('accepts a blocked preflight response with a minimal blocker list', () => {
    expect(
      identityDeleteAccountPreflightResponse.zod.safeParse({
        status: 'blocked',
        blockingOrganizations: [
          {
            organizationId: 'org_12345678',
            organizationName: 'Acme',
            organizationKind: 'organization',
          },
        ],
        requiredLifecycle: {
          coolingHours: 168,
          onlineCleanupDays: 7,
          auditRetentionYears: 1,
          backupRetentionDays: 35,
        },
        serverTime: UTC,
      }).success,
    ).toBe(true);
  });

  it('accepts an unavailable preflight response (fail-closed projection)', () => {
    expect(
      identityDeleteAccountPreflightResponse.zod.safeParse({
        status: 'unavailable',
        requiredLifecycle: {
          coolingHours: 168,
          onlineCleanupDays: 7,
          auditRetentionYears: 1,
          backupRetentionDays: 35,
        },
        serverTime: UTC,
      }).success,
    ).toBe(true);
  });

  it('rejects a preflight status outside the enum', () => {
    expect(
      identityDeleteAccountPreflightResponse.zod.safeParse({
        status: 'in_progress',
        requiredLifecycle: {
          coolingHours: 168,
          onlineCleanupDays: 7,
          auditRetentionYears: 1,
          backupRetentionDays: 35,
        },
        serverTime: UTC,
      }).success,
    ).toBe(false);
  });

  it('rejects a preflight response leaking an undeclared field (closed object)', () => {
    expect(
      identityDeleteAccountPreflightResponse.zod.safeParse({
        status: 'blocked',
        blockingOrganizations: [
          {
            organizationId: 'org_12345678',
            organizationName: 'Acme',
            organizationKind: 'organization',
          },
        ],
        requiredLifecycle: {
          coolingHours: 168,
          onlineCleanupDays: 7,
          auditRetentionYears: 1,
          backupRetentionDays: 35,
        },
        serverTime: UTC,
        successorAccountId: 'acct_x',
      }).success,
    ).toBe(false);
  });

  it('rejects a blocking organization with an invalid kind', () => {
    expect(
      identityDeleteAccountPreflightResponse.zod.safeParse({
        status: 'blocked',
        blockingOrganizations: [
          {
            organizationId: 'org_12345678',
            organizationName: 'Acme',
            organizationKind: 'enterprise',
          },
        ],
        requiredLifecycle: {
          coolingHours: 168,
          onlineCleanupDays: 7,
          auditRetentionYears: 1,
          backupRetentionDays: 35,
        },
        serverTime: UTC,
      }).success,
    ).toBe(false);
  });

  it('accepts a valid delete-account request', () => {
    expect(
      identityDeleteAccountRequest.zod.safeParse({
        currentPassword: 'Current-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing currentPassword on delete-account', () => {
    expect(
      identityDeleteAccountRequest.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field on delete-account request (closed object)', () => {
    expect(
      identityDeleteAccountRequest.zod.safeParse({
        currentPassword: 'Current-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
        intentConfirmationToken: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid delete-account response', () => {
    expect(
      identityDeleteAccountResponse.zod.safeParse({
        status: 'succeeded',
        accountStatus: 'deletion_cooling',
        deletionRequestedAt: UTC,
        deletionCoolingEndsAt: '2026-08-16T01:00:00.000Z',
        sessionImpact: 'revoked_all',
      }).success,
    ).toBe(true);
  });

  it('rejects a delete-account response with a non-deletion accountStatus', () => {
    expect(
      identityDeleteAccountResponse.zod.safeParse({
        status: 'succeeded',
        accountStatus: 'active',
        deletionRequestedAt: UTC,
        deletionCoolingEndsAt: '2026-08-16T01:00:00.000Z',
        sessionImpact: 'revoked_all',
      }).success,
    ).toBe(false);
  });

  it('rejects a delete-account response with an undeclared field', () => {
    expect(
      identityDeleteAccountResponse.zod.safeParse({
        status: 'succeeded',
        accountStatus: 'deletion_cooling',
        deletionRequestedAt: UTC,
        deletionCoolingEndsAt: '2026-08-16T01:00:00.000Z',
        sessionImpact: 'revoked_all',
        rawToken: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid cancel-deletion request', () => {
    expect(
      identityCancelAccountDeletionRequest.zod.safeParse({
        currentPassword: 'Current-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing currentPassword on cancel-deletion', () => {
    expect(
      identityCancelAccountDeletionRequest.zod.safeParse({ idempotencyKey: 'k'.repeat(36) })
        .success,
    ).toBe(false);
  });

  it('accepts a valid cancel-deletion response', () => {
    expect(
      identityCancelAccountDeletionResponse.zod.safeParse({
        status: 'succeeded',
        accountStatus: 'active',
        sessionImpact: 'revoked_all',
      }).success,
    ).toBe(true);
  });

  it('rejects a cancel-deletion response leaking a deletion status', () => {
    expect(
      identityCancelAccountDeletionResponse.zod.safeParse({
        status: 'succeeded',
        accountStatus: 'deletion_cooling',
        sessionImpact: 'revoked_all',
      }).success,
    ).toBe(false);
  });

  it('accepts intent-link path params with a token', () => {
    expect(
      identityDeleteAccountIntentLinkPathParams.zod.safeParse({ token: 'short-lived-token' })
        .success,
    ).toBe(true);
    expect(
      identityCancelAccountDeletionIntentLinkPathParams.zod.safeParse({
        token: 'short-lived-token',
      }).success,
    ).toBe(true);
  });

  it('rejects intent-link path params without a token', () => {
    expect(identityDeleteAccountIntentLinkPathParams.zod.safeParse({}).success).toBe(false);
  });

  it('accepts a valid delete intent-link response without a masked email', () => {
    expect(
      identityDeleteAccountIntentLinkResponse.zod.safeParse({
        status: 'valid',
        csrf: 'csrf_secret',
        intentKind: 'deletion_request',
      }).success,
    ).toBe(true);
  });

  it('accepts a valid cancel intent-link response with a masked email', () => {
    expect(
      identityCancelAccountDeletionIntentLinkResponse.zod.safeParse({
        status: 'valid',
        csrf: 'csrf_secret',
        maskedEmail: 'us**@example.invalid',
        intentKind: 'deletion_cancel',
      }).success,
    ).toBe(true);
  });

  it('rejects an intent-link response with an invalid intent kind', () => {
    expect(
      identityDeleteAccountIntentLinkResponse.zod.safeParse({
        status: 'valid',
        csrf: 'csrf_secret',
        intentKind: 'email_verification',
      }).success,
    ).toBe(false);
  });

  it('rejects an intent-link response leaking the raw token (closed object)', () => {
    expect(
      identityCancelAccountDeletionIntentLinkResponse.zod.safeParse({
        status: 'valid',
        csrf: 'csrf_secret',
        intentKind: 'deletion_cancel',
        token: 'raw-token',
      }).success,
    ).toBe(false);
  });
});
