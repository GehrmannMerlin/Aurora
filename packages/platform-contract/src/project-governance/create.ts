import { enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_CREATE_PROJECT = 'organizationCreateProject' as const;

export const organizationCreateProjectPathParams = obj({
  organizationId: OrganizationId,
});

// B2 atomic project creation. The client key is generated server-side and only its PUBLIC
// identifier is returned — the key secret is never exposed through this contract.
export const organizationCreateProjectRequest = obj({
  name: str(2, 50),
  frameworkType: enum_(['javascript', 'react', 'vue', 'other']),
  websiteUrl: optional(str(8, 512)),
  idempotencyKey,
});

export const organizationCreateProjectResponse = obj({
  projectId: ProjectId,
  clientKeyPublicIdentifier: str(11, 128),
  defaultEnvironment: str(1, 32),
  onboardingStatus: enum_(['not_started', 'in_progress', 'completed']),
  navigationTargets,
});
