/**
 * @aurora/platform-organization — Aurora platform workspace and organization
 * governance data layer.
 *
 * This module is the package root. It exposes:
 * - one-time intent token generation + email canonicalization + masking
 *   (`createIntentToken`/`normalizeEmail`/`maskEmail`); local copies of the
 *   PLT-03 helpers because this data-layer package may not depend on
 *   `@aurora/platform-identity`;
 * - repositories over the PLT-03 `organizations`/`organization_members`/
 *   `organization_invitations` tables plus the PLT-04 settings-version
 *   migration (organizations, members, invitations, timezone);
 * - the stable PlatformOrganizationError surface.
 *
 * This is a data-layer package: it depends only on {protocol} workspace
 * packages (none currently) and plain `pg`. It never imports or declares
 * `@aurora/platform-contract` (contract layer) per Workspace Policy.
 */
export const PLATFORM_ORGANIZATION_PACKAGE = '@aurora/platform-organization' as const;

export const PLATFORM_ORGANIZATION_VERSION = '0.0.0' as const;

export { createIntentToken, maskEmail, normalizeEmail } from './intent-token.js';

export { PlatformOrganizationError, type PlatformOrganizationErrorKind } from './errors.js';

export type { OrganizationRole } from './repositories/organizations.js';
export {
  countOrganizationOwners,
  findMembership,
  getOrganizationById,
  isUniqueOrganizationOwner,
  listAccountOrganizations,
  type AccountOrganizationMembership,
  type FindMembershipInput,
  type IsUniqueOrganizationOwnerInput,
  type MembershipRow,
  type OrganizationRow,
} from './repositories/organizations.js';

export {
  changeOrganizationRole,
  listMembers,
  removeMember,
  transferOwnership,
  type ChangeRoleInput,
  type ChangeRoleResult,
  type MemberRow,
  type RemoveMemberInput,
  type RemoveMemberResult,
  type TransferOwnershipInput,
  type TransferOwnershipResult,
} from './repositories/members.js';

export {
  inviteMember,
  listPendingInvitations,
  resendInvitation,
  revokeInvitation,
  type InvitationRow,
  type InvitedOrganizationRole,
  type InviteMemberInput,
  type InviteMemberResult,
  type ResendInvitationInput,
  type ResendInvitationResult,
  type RevokeInvitationInput,
  type RevokeInvitationResult,
} from './repositories/invitations.js';

export {
  getOrganizationSettings,
  isValidTimezone,
  updateOrganizationTimezone,
  type OrganizationSettings,
  type UpdateTimezoneInput,
  type UpdateTimezoneResult,
} from './repositories/timezone.js';
