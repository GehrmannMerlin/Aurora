import { enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_CREATE_PROJECT = 'organizationCreateProject' as const;

export const organizationCreateProjectPathParams = obj({
  organizationId: OrganizationId,
});

// B2 atomic project creation. The browser-safe ingestion key is generated
// server-side, stored only as a digest, and delivered once in the first
// successful response so the user can complete SDK onboarding.
export const organizationCreateProjectRequest = obj({
  name: str(2, 50),
  frameworkType: enum_(['javascript', 'react', 'vue', 'other']),
  websiteUrl: optional(str(8, 512)),
  idempotencyKey,
});

export const organizationCreateProjectResponse = obj({
  projectId: ProjectId,
  clientKeyPublicIdentifier: str(11, 128),
  clientKey: optional(str(32, 256)),
  defaultEnvironment: str(1, 32),
  onboardingStatus: enum_(['not_started', 'in_progress', 'completed']),
  navigationTargets,
});
