import { arr, bool, enum_, nullable, num, obj, optional, str } from '../common/schema.js';
import { AccountId, OrganizationId, ProjectId } from '../common/identifiers.js';
import { navigationTargets, routeTarget } from '../common/navigation.js';

export const OPERATION_ID_NAVIGATION = 'navigationGetContext' as const;

const accountSummary = obj({
  accountId: AccountId,
  email: str(3, 320),
  verified: bool(),
});

const projectNav = obj({
  projectId: ProjectId,
  name: str(1, 128),
  lifecycle: enum_(['active', 'archived']),
  entry: routeTarget,
});

const organizationNav = obj({
  organizationId: OrganizationId,
  name: str(1, 128),
  projects: arr(projectNav),
  entry: routeTarget,
});

const scopeState = obj({
  type: enum_(['workspace', 'organization', 'project']),
  id: optional(str(1, 64)),
  lifecycle: enum_(['active', 'archived', 'trash']),
});

/** Account-level unread notification count (PLT-09). Honest `unavailable`. */
const unreadCount = obj({
  value: optional(num(0)),
  status: enum_(['available', 'unavailable']),
});

export const navigationGetContextResponse = obj({
  account: accountSummary,
  workspace: navigationTargets,
  organizations: arr(organizationNav),
  currentScope: nullable(scopeState),
  defaultTarget: routeTarget,
  safeExitTarget: routeTarget,
  unreadCount,
});
