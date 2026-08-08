import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CHANGE_PASSWORD,
  OPERATION_ID_CONFIRM_PASSWORD_RESET,
  OPERATION_ID_REQUEST_PASSWORD_RESET,
  identityChangePasswordRequest,
  identityChangePasswordResponse,
  identityConfirmPasswordResetRequest,
  identityConfirmPasswordResetResponse,
  identityRequestPasswordResetRequest,
  identityRequestPasswordResetResponse,
} from '../../src/identity/password.js';

describe('password contract', () => {
  it('has the frozen operation ids', () => {
    expect(OPERATION_ID_REQUEST_PASSWORD_RESET).toBe('identityRequestPasswordReset');
    expect(OPERATION_ID_CONFIRM_PASSWORD_RESET).toBe('identityConfirmPasswordReset');
    expect(OPERATION_ID_CHANGE_PASSWORD).toBe('identityChangePassword');
  });

  it('accepts a valid request-password-reset request', () => {
    expect(
      identityRequestPasswordResetRequest.zod.safeParse({
        email: 'user@example.invalid',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing email on request-password-reset', () => {
    expect(
      identityRequestPasswordResetRequest.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field on request-password-reset (closed object)', () => {
    expect(
      identityRequestPasswordResetRequest.zod.safeParse({
        email: 'user@example.invalid',
        idempotencyKey: 'k'.repeat(36),
        token: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid request-password-reset response without secrets', () => {
    expect(
      identityRequestPasswordResetResponse.zod.safeParse({
        serverTime: '2026-08-09T01:00:00.000Z',
        nextRequestAllowedAt: '2026-08-09T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects a request-password-reset response leaking a raw token', () => {
    expect(
      identityRequestPasswordResetResponse.zod.safeParse({
        serverTime: '2026-08-09T01:00:00.000Z',
        nextRequestAllowedAt: '2026-08-09T01:00:00.000Z',
        resetToken: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid confirm-password-reset request', () => {
    expect(
      identityConfirmPasswordResetRequest.zod.safeParse({
        newPassword: 's3cure-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing newPassword on confirm-password-reset', () => {
    expect(
      identityConfirmPasswordResetRequest.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field on confirm-password-reset (closed object)', () => {
    expect(
      identityConfirmPasswordResetRequest.zod.safeParse({
        newPassword: 's3cure-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
        token: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid confirm-password-reset response', () => {
    expect(
      identityConfirmPasswordResetResponse.zod.safeParse({
        status: 'succeeded',
        serverTime: '2026-08-09T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a valid change-password request', () => {
    expect(
      identityChangePasswordRequest.zod.safeParse({
        currentPassword: 'Old-Passw0rd!',
        newPassword: 'New-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing currentPassword on change-password', () => {
    expect(
      identityChangePasswordRequest.zod.safeParse({
        newPassword: 'New-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field on change-password request (closed object)', () => {
    expect(
      identityChangePasswordRequest.zod.safeParse({
        currentPassword: 'Old-Passw0rd!',
        newPassword: 'New-Passw0rd!',
        idempotencyKey: 'k'.repeat(36),
        sessionId: 's_1',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid change-password response', () => {
    expect(
      identityChangePasswordResponse.zod.safeParse({
        status: 'succeeded',
        sessionImpact: 'revoked_all',
      }).success,
    ).toBe(true);
  });

  it('rejects a change-password response with an undeclared field', () => {
    expect(
      identityChangePasswordResponse.zod.safeParse({
        status: 'succeeded',
        sessionImpact: 'revoked_all',
        rawToken: 'x',
      }).success,
    ).toBe(false);
  });
});
