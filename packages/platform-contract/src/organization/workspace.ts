import { arr, enum_, obj, str } from '../common/schema.js';
import { allowedActions } from '../common/authorization.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_LIST_PROJECTS = 'organizationListProjects' as const;

// B1 workspace list: the path param is the only request input for this query.
export const organizationListProjectsRequest = obj({
  organizationId: OrganizationId,
});

// `deleting` is a transient cleanup state and is never exposed to the UI.
const projectLifecycle = enum_(['active', 'archived', 'trash']);

const projectSummary = obj({
  projectId: ProjectId,
  name: str(2, 50),
  frameworkType: enum_(['javascript', 'react', 'vue', 'other']),
  status: projectLifecycle,
  lifecycle: projectLifecycle,
});

export const organizationListProjectsResponse = obj({
  projects: arr(projectSummary, 0, 500),
  allowedActions,
  navigationTargets,
});
