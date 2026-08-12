import { arr, enum_, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { sectionResult } from '../common/section.js';
import { idempotencyKey, resourceVersion } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { EnvironmentId, OrganizationId, ProjectId } from '../common/identifiers.js';

/**
 * C15 project settings contract (UX/UI §7.30 / PRD §13). Only the project name
 * and the optional production website URL are editable; framework/ingest type is
 * read-only. The lifecycle summary is included so the C16 lifecycle page can
 * consume the same authoritative project object (no second model).
 */

export const OPERATION_ID_SETTINGS_GET = 'settingsGetProject' as const;
export const OPERATION_ID_SETTINGS_UPDATE = 'settingsUpdateProject' as const;
export const OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS = 'settingsListEnvironments' as const;
export const OPERATION_ID_SETTINGS_CREATE_ENVIRONMENT = 'settingsCreateEnvironment' as const;

export const PROJECT_LIFECYCLE_STATUS = ['active', 'archived', 'trash', 'deleting'] as const;

const projectLifecycle = obj({
  status: enum_(PROJECT_LIFECYCLE_STATUS),
  archivedAt: optional(utcTimestamp),
  trashedAt: optional(utcTimestamp),
  recoverableUntil: optional(utcTimestamp),
});

const projectSettings = obj({
  projectId: ProjectId,
  name: str(2, 50),
  frameworkType: enum_(['javascript', 'react', 'vue', 'other']),
  websiteUrl: optional(str(8, 512)),
  lifecycle: projectLifecycle,
  resourceVersion,
});

export const settingsGetProjectPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const settingsGetProjectResponse = queryResponse(
  obj({ project: projectSettings }),
);

export const settingsUpdateProjectPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const settingsUpdateProjectBody = obj({
  name: str(2, 50),
  websiteUrl: optional(str(8, 512)),
  resourceVersion,
  idempotencyKey,
});

export const settingsUpdateProjectResponse = obj({
  data: obj({
    status: enum_(['updated']),
    projectId: ProjectId,
    name: str(2, 50),
    websiteUrl: optional(str(8, 512)),
    resourceVersion,
  }),
});

const environmentSummary = obj({
  environmentId: EnvironmentId,
  name: str(1, 32),
  isDefault: str(1, 16),
  createdAt: utcTimestamp,
});

export const settingsListEnvironmentsPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const settingsListEnvironmentsResponse = queryResponse(
  sectionResult(obj({ items: arr(environmentSummary, 0, 200) })),
);

export const settingsCreateEnvironmentPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const settingsCreateEnvironmentBody = obj({
  name: str(1, 32),
  idempotencyKey,
});

export const settingsCreateEnvironmentResponse = obj({
  data: obj({
    status: enum_(['created']),
    environmentId: EnvironmentId,
    name: str(1, 32),
  }),
});
