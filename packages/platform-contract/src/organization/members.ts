import { arr, enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey, resourceVersion } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { AccountId, OrganizationId } from '../common/identifiers.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_LIST_MEMBERS = 'organizationListMembers' as const;
export const OPERATION_ID_CHANGE_ROLE = 'organizationChangeRole' as const;
export const OPERATION_ID_REMOVE_MEMBER = 'organizationRemoveMember' as const;
export const OPERATION_ID_TRANSFER_OWNERSHIP = 'organizationTransferOwnership' as const;

const orgRole = enum_(['owner', 'admin', 'member']);

// B3 membership list: the path param is the only request input for this query.
export const organizationListMembersRequest = obj({
  organizationId: OrganizationId,
});

const memberSummary = obj({
  accountId: AccountId,
  emailMasked: str(3, 320),
  orgRole,
  joinedAt: optional(utcTimestamp),
});

export const organizationListMembersResponse = obj({
  members: arr(memberSummary, 0, 500),
  navigationTargets,
});

export const organizationChangeRolePathParams = obj({
  organizationId: OrganizationId,
  accountId: AccountId,
});

// owner cannot be assigned through ChangeRole: it is only reachable via TransferOwnership.
export const organizationChangeRoleRequest = obj({
  orgRole: enum_(['admin', 'member']),
  resourceVersion,
});

export const organizationChangeRoleResponse = obj({
  accountId: AccountId,
  orgRole,
  resourceVersion,
});

export const organizationRemoveMemberPathParams = obj({
  organizationId: OrganizationId,
  accountId: AccountId,
});

export const organizationRemoveMemberRequest = obj({
  resourceVersion,
});

export const organizationRemoveMemberResponse = obj({
  status: enum_(['succeeded']),
  accountId: AccountId,
});

export const organizationTransferOwnershipPathParams = obj({
  organizationId: OrganizationId,
});

export const organizationTransferOwnershipRequest = obj({
  newOwnerAccountId: AccountId,
  idempotencyKey,
});

export const organizationTransferOwnershipResponse = obj({
  organizationId: OrganizationId,
  ownerAccountId: AccountId,
  resourceVersion,
  navigationTargets,
});
