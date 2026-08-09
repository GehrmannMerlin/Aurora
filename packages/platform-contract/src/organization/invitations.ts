import { arr, enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { InvitationId, OrganizationId, ProjectId } from '../common/identifiers.js';

export const OPERATION_ID_INVITE_MEMBER = 'organizationInviteMember' as const;
export const OPERATION_ID_REVOKE_INVITATION = 'organizationRevokeInvitation' as const;
export const OPERATION_ID_RESEND_INVITATION = 'organizationResendInvitation' as const;

export const organizationInviteMemberPathParams = obj({
  organizationId: OrganizationId,
});

const projectGrant = obj({
  projectId: ProjectId,
  projectRole: enum_(['project_admin', 'developer', 'read_only']),
});

// Invitations never carry a password, token or invite-secret in the body: the one-time intent
// token is delivered via the HttpOnly intent cookie by the accept flow (PLT-03).
export const organizationInviteMemberRequest = obj({
  email: str(3, 320),
  orgRole: enum_(['admin', 'member']),
  projectGrants: optional(arr(projectGrant, 1, 50)),
  idempotencyKey,
});

export const organizationInviteMemberResponse = obj({
  invitationId: InvitationId,
  invitedEmailMasked: str(3, 320),
  expiresAt: utcTimestamp,
  status: enum_(['pending']),
});

export const organizationRevokeInvitationRequest = obj({
  organizationId: OrganizationId,
  invitationId: InvitationId,
});

export const organizationRevokeInvitationResponse = obj({
  status: enum_(['succeeded']),
  invitationId: InvitationId,
});

export const organizationResendInvitationRequest = obj({
  organizationId: OrganizationId,
  invitationId: InvitationId,
});

export const organizationResendInvitationResponse = obj({
  status: enum_(['succeeded']),
  invitationId: InvitationId,
  expiresAt: utcTimestamp,
});
