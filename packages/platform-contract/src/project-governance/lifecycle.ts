import { enum_, obj } from '../common/schema.js';
import { idempotencyKey, resourceVersion } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';

/**
 * C16 project lifecycle contract (UX/UI §8.29 / PRD §17). Archive, restore-from-
 * archive and move-to-trash are distinct high-risk commands with their own
 * confirmation and audit. Permanent delete (after the trash recovery window) is
 * a background retention concern (SEC-02) and is NOT exposed here.
 */

export const OPERATION_ID_LIFECYCLE_ARCHIVE = 'lifecycleArchiveProject' as const;
export const OPERATION_ID_LIFECYCLE_RESTORE = 'lifecycleRestoreProject' as const;
export const OPERATION_ID_LIFECYCLE_MOVE_TO_TRASH = 'lifecycleMoveToTrash' as const;

export const lifecycleArchiveProjectPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const lifecycleArchiveProjectBody = obj({ idempotencyKey });

export const lifecycleArchiveProjectResponse = obj({
  data: obj({
    status: enum_(['archived']),
    projectId: ProjectId,
  }),
});

export const lifecycleRestoreProjectPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const lifecycleRestoreProjectBody = obj({ idempotencyKey });

export const lifecycleRestoreProjectResponse = obj({
  data: obj({
    status: enum_(['restored']),
    projectId: ProjectId,
  }),
});

export const lifecycleMoveToTrashPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const lifecycleMoveToTrashBody = obj({
  resourceVersion,
  idempotencyKey,
});

export const lifecycleMoveToTrashResponse = obj({
  data: obj({
    status: enum_(['trashed']),
    projectId: ProjectId,
    trashedAt: utcTimestamp,
    recoverableUntil: utcTimestamp,
  }),
});
