import { enum_, obj, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { OrganizationId } from '../common/identifiers.js';
import { routeTarget } from '../common/navigation.js';

export const OPERATION_ID_ACCEPT_INVITATION = 'organizationAcceptInvitation' as const;

// The one-time invitation token is carried by the HttpOnly intent cookie, never in the body.
export const organizationAcceptInvitationRequest = obj({
  idempotencyKey,
});

export const organizationAcceptInvitationResponse = obj({
  organization: obj({
    organizationId: OrganizationId,
    name: str(1, 128),
    role: enum_(['owner', 'admin', 'member']),
  }),
  navigationTargets: routeTarget,
});
