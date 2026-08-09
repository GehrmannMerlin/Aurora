import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_INVITE_MEMBER,
  OPERATION_ID_RESEND_INVITATION,
  OPERATION_ID_REVOKE_INVITATION,
  organizationInviteMemberRequest,
  organizationInviteMemberResponse,
  organizationResendInvitationRequest,
  organizationResendInvitationResponse,
  organizationRevokeInvitationRequest,
  organizationRevokeInvitationResponse,
} from '../../src/organization/invitations.js';

describe('organizationInviteMember contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_INVITE_MEMBER).toBe('organizationInviteMember');
  });

  it('accepts a valid invite request', () => {
    expect(
      organizationInviteMemberRequest.zod.safeParse({
        email: 'user@example.invalid',
        orgRole: 'admin',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('accepts a valid invite request with project grants', () => {
    expect(
      organizationInviteMemberRequest.zod.safeParse({
        email: 'user@example.invalid',
        orgRole: 'member',
        projectGrants: [{ projectId: 'prj_1', projectRole: 'developer' }],
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects owner as an invite role', () => {
    expect(
      organizationInviteMemberRequest.zod.safeParse({
        email: 'user@example.invalid',
        orgRole: 'owner',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('rejects a missing email', () => {
    expect(
      organizationInviteMemberRequest.zod.safeParse({
        orgRole: 'member',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field (closed object, no secret channel)', () => {
    expect(
      organizationInviteMemberRequest.zod.safeParse({
        email: 'user@example.invalid',
        orgRole: 'member',
        idempotencyKey: 'k'.repeat(36),
        inviteToken: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid invite response', () => {
    expect(
      organizationInviteMemberResponse.zod.safeParse({
        invitationId: 'inv_123',
        invitedEmailMasked: 'us**@example.invalid',
        expiresAt: '2026-08-16T01:00:00.000Z',
        status: 'pending',
      }).success,
    ).toBe(true);
  });

  it('rejects a response leaking the full email', () => {
    expect(
      organizationInviteMemberResponse.zod.safeParse({
        invitationId: 'inv_123',
        invitedEmailMasked: 'user@example.invalid',
        email: 'user@example.invalid',
        expiresAt: '2026-08-16T01:00:00.000Z',
        status: 'pending',
      }).success,
    ).toBe(false);
  });
});

describe('organizationRevokeInvitation contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_REVOKE_INVITATION).toBe('organizationRevokeInvitation');
  });

  it('accepts a valid revoke request', () => {
    expect(
      organizationRevokeInvitationRequest.zod.safeParse({
        organizationId: 'org_1',
        invitationId: 'inv_123',
      }).success,
    ).toBe(true);
  });

  it('rejects a missing invitationId', () => {
    expect(
      organizationRevokeInvitationRequest.zod.safeParse({ organizationId: 'org_1' }).success,
    ).toBe(false);
  });

  it('accepts a valid revoke response', () => {
    expect(
      organizationRevokeInvitationResponse.zod.safeParse({
        status: 'succeeded',
        invitationId: 'inv_123',
      }).success,
    ).toBe(true);
  });
});

describe('organizationResendInvitation contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_RESEND_INVITATION).toBe('organizationResendInvitation');
  });

  it('accepts a valid resend request', () => {
    expect(
      organizationResendInvitationRequest.zod.safeParse({
        organizationId: 'org_1',
        invitationId: 'inv_123',
      }).success,
    ).toBe(true);
  });

  it('accepts a valid resend response', () => {
    expect(
      organizationResendInvitationResponse.zod.safeParse({
        status: 'succeeded',
        invitationId: 'inv_123',
        expiresAt: '2026-08-16T01:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
