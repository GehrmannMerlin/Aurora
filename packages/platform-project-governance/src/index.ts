/**
 * @aurora/platform-project-governance — Aurora platform project governance data
 * layer (PLT-04 B1/B2/B8).
 *
 * This module is the package root. It exposes repositories over the
 * `projects`/`client_keys`/`project_environments`/`project_onboarding`
 * tables created by this package's migration, plus the B8 trash lifecycle:
 * - `createProject` — ATOMIC {project + default production env + default client
 *   key (public_identifier + key_digest) + onboarding row} in one transaction;
 *   the client-key secret is generated once, reduced to its SHA-256 digest, and
 *   never persisted or returned by this package.
 * - `listProjects` — spec §6 permission-filtered projection (owner/admin see
 *   all org projects; other members see only assigned projects).
 * - `updateProjectStatus` (archive), `trashProject`, `listTrash`,
 *   `restoreProject` (G10 APPROVED B8 restore safety rules).
 * - `revokeClientKey` (irreversible disable), `insertProjectMember`.
 * - the stable PlatformProjectGovernanceError surface.
 *
 * This is a data-layer package: it depends only on {protocol} workspace
 * packages (none currently) and plain `pg`. It never imports or declares
 * `@aurora/platform-contract` (contract layer) per Workspace Policy
 * (data → {protocol}).
 */
export const PLATFORM_PROJECT_GOVERNANCE_PACKAGE = '@aurora/platform-project-governance' as const;

export const PLATFORM_PROJECT_GOVERNANCE_VERSION = '0.0.0' as const;

export {
  PlatformProjectGovernanceError,
  type PlatformProjectGovernanceErrorKind,
} from './errors.js';

export type {
  FrameworkType,
  ProjectRole,
  ProjectRow,
  ProjectStatus,
} from './repositories/projects.js';
export {
  createProject,
  getProjectById,
  insertProjectMember,
  listProjects,
  updateProjectStatus,
  type CreateProjectInput,
  type CreateProjectResult,
  type GetProjectInput,
  type InsertProjectMemberInput,
  type InsertProjectMemberResult,
  type ListProjectsInput,
  type UpdateProjectStatusInput,
  type UpdateProjectStatusResult,
} from './repositories/projects.js';

export {
  revokeClientKey,
  type ClientKeyRow,
  type RevokeClientKeyInput,
  type RevokeClientKeyResult,
} from './repositories/client-keys.js';

export {
  getOnboarding,
  updateOnboardingStatus,
  type OnboardingRow,
  type OnboardingStatus,
  type UpdateOnboardingStatusInput,
  type UpdateOnboardingStatusResult,
} from './repositories/onboarding.js';

export {
  listTrash,
  restoreProject,
  trashProject,
  type RestoreProjectInput,
  type RestoreProjectResult,
  type TrashProjectInput,
  type TrashProjectResult,
} from './repositories/trash.js';
