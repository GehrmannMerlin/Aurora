import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_ACCEPT_INVITATION,
  organizationAcceptInvitationRequest,
  organizationAcceptInvitationResponse,
} from '../../src/identity/invitation.js';

describe('organizationAcceptInvitation contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_ACCEPT_INVITATION).toBe('organizationAcceptInvitation');
  });

  it('accepts a valid accept request', () => {
    expect(
      organizationAcceptInvitationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing idempotencyKey', () => {
    expect(organizationAcceptInvitationRequest.zod.safeParse({}).success).toBe(false);
  });

  it('rejects an undeclared field (closed object)', () => {
    expect(
      organizationAcceptInvitationRequest.zod.safeParse({
        idempotencyKey: 'k'.repeat(36),
        token: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid accept response without secrets', () => {
    expect(
      organizationAcceptInvitationResponse.zod.safeParse({
        organization: { organizationId: 'org_1', name: 'Acme', role: 'member' },
        navigationTargets: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
      }).success,
    ).toBe(true);
  });

  it('rejects a response leaking a raw token or full role list', () => {
    expect(
      organizationAcceptInvitationResponse.zod.safeParse({
        organization: {
          organizationId: 'org_1',
          name: 'Acme',
          role: 'member',
          inviteToken: 'x',
          permissions: ['read', 'write'],
        },
        navigationTargets: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
      }).success,
    ).toBe(false);
  });
});
