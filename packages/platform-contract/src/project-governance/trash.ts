import { arr, enum_, obj, str } from '../common/schema.js';
import { idempotencyKey, resourceVersion } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_LIST_TRASH = 'projectGovernanceListTrash' as const;
export const OPERATION_ID_RESTORE_PROJECT = 'projectGovernanceRestoreProject' as const;

export const projectGovernanceListTrashRequest = obj({
  organizationId: OrganizationId,
});

const trashedProjectSummary = obj({
  projectId: ProjectId,
  name: str(2, 50),
  frameworkType: enum_(['javascript', 'react', 'vue', 'other']),
  trashedAt: utcTimestamp,
  recoverableUntil: utcTimestamp,
  lifecycle: enum_(['trash']),
});

export const projectGovernanceListTrashResponse = obj({
  projects: arr(trashedProjectSummary, 0, 500),
  navigationTargets,
});

export const projectGovernanceRestoreProjectPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

// B8 restore follows the G10 safety rules; optimistic concurrency + idempotency.
export const projectGovernanceRestoreProjectRequest = obj({
  resourceVersion,
  idempotencyKey,
});

export const projectGovernanceRestoreProjectResponse = obj({
  projectId: ProjectId,
  status: enum_(['active']),
  lifecycle: enum_(['active']),
  navigationTargets,
});
