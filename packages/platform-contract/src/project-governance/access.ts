import { arr, enum_, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { sectionResult } from '../common/section.js';
import { idempotencyKey } from '../common/command.js';
import { AccountId, OrganizationId, ProjectId } from '../common/identifiers.js';

/**
 * C13 project access contract (UX/UI §7.28 / PRD §13). Effective access is the
 * server-authoritative per-person projection: an org manager (owner/admin)
 * inherits `project_admin` capability regardless of a `project_members` row; any
 * other org member resolves their explicit project role. `sources` lists why the
 * person has access (`org_inherited` and/or `project_member`) so the UI never
 * merges the org member table and the project member table itself.
 */

export const OPERATION_ID_ACCESS_LIST = 'accessListEffectiveMembers' as const;
export const OPERATION_ID_ACCESS_GRANT = 'accessGrantProjectMembership' as const;
export const OPERATION_ID_ACCESS_CHANGE_ROLE = 'accessChangeProjectRole' as const;
export const OPERATION_ID_ACCESS_REMOVE = 'accessRemoveProjectMembership' as const;

export const PROJECT_ROLE_VALUES = ['project_admin', 'developer', 'read_only'] as const;

const effectiveMember = obj({
  accountId: AccountId,
  maskedEmail: str(1, 320),
  effectiveRole: enum_(PROJECT_ROLE_VALUES),
  sources: arr(enum_(['org_inherited', 'project_member']), 1, 2),
  projectRole: optional(enum_(PROJECT_ROLE_VALUES)),
  allowedActions: arr(enum_(['read', 'manage']), 1, 2),
});

export const accessListEffectiveMembersPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const accessListEffectiveMembersResponse = queryResponse(
  sectionResult(obj({ items: arr(effectiveMember, 0, 200) })),
);

export const accessGrantProjectMembershipPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const accessGrantProjectMembershipBody = obj({
  accountId: AccountId,
  role: enum_(PROJECT_ROLE_VALUES),
  idempotencyKey,
});

export const accessGrantProjectMembershipResponse = obj({
  data: obj({
    status: enum_(['granted']),
    accountId: AccountId,
    role: enum_(PROJECT_ROLE_VALUES),
  }),
});

export const accessChangeProjectRolePathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  accountId: AccountId,
});

export const accessChangeProjectRoleBody = obj({
  role: enum_(PROJECT_ROLE_VALUES),
  idempotencyKey,
});

export const accessChangeProjectRoleResponse = obj({
  data: obj({
    status: enum_(['changed']),
    accountId: AccountId,
    role: enum_(PROJECT_ROLE_VALUES),
  }),
});

export const accessRemoveProjectMembershipPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
  accountId: AccountId,
});

export const accessRemoveProjectMembershipBody = obj({
  idempotencyKey,
});

export const accessRemoveProjectMembershipResponse = obj({
  data: obj({
    status: enum_(['removed']),
    accountId: AccountId,
    remainingSources: arr(enum_(['org_inherited', 'project_member']), 0, 2),
  }),
});
