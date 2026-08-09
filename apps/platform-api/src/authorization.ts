import type { Pool, PoolClient } from 'pg';
import { findMembership, type OrganizationRole } from '@aurora/platform-organization';

/**
 * The UI action projection for an organization (spec §6). `allowedActions` is a
 * pure display hint: every Command re-reads the current `organization_members`
 * row and never trusts this projection for authorization.
 */
export const ORG_MANAGER_ACTIONS = [
  'create-project',
  'manage-members',
  'manage-invitations',
  'update-settings',
  'manage-tokens',
  'view-audit',
  'manage-trash',
  'restore',
] as const;

export type OrgManagerAction = (typeof ORG_MANAGER_ACTIONS)[number];

/**
 * Minimal action projection for a plain `member`: none of the manager-only
 * actions (create-project, members/invitations, settings, tokens, audit, trash,
 * restore) are available to a non-manager (spec §6). A non-member also gets an
 * empty projection.
 */
export const MEMBER_ACTIONS: readonly OrgManagerAction[] = [];

/** The actor's organization role, or null when not a member of the org. */
export type EffectiveOrgRole = OrganizationRole | null;

/** Effective organization permissions for an account in an organization. */
export interface EffectivePermissions {
  readonly orgRole: EffectiveOrgRole;
  /** owner or admin — may manage org members/invitations/settings/tokens/audit/trash. */
  readonly isOrgManager: boolean;
  /** owner — the only role allowed to transfer ownership. */
  readonly isOwner: boolean;
  /** UI-only action projection (spec §6); never authorizes a Command. */
  readonly allowedActions: readonly OrgManagerAction[];
}

/** Minimal dependencies needed to re-read the actor's membership row. */
export interface AuthorizationDeps {
  readonly pool: Pool | PoolClient;
}

/**
 * Compute the effective organization permissions for an account by re-reading
 * its `organization_members` row fresh on every call (spec §6: queries compute
 * effective permissions; every Command re-reads). Roles are never cached.
 *
 * Data-layer failures (`PlatformOrganizationError`) propagate to the caller,
 * which maps them via `sendMappedError` (503 authority_unavailable for
 * database_unavailable / statement_failed, 400 structural_error for
 * invalid_input).
 */
export async function effectivePermissions(
  accountId: string,
  orgId: string,
  deps: AuthorizationDeps,
): Promise<EffectivePermissions> {
  const membership = await findMembership(deps.pool, { orgId, accountId });
  if (membership === null) {
    return { orgRole: null, isOrgManager: false, isOwner: false, allowedActions: [] };
  }
  const orgRole = membership.role;
  const isOrgManager = orgRole === 'owner' || orgRole === 'admin';
  return {
    orgRole,
    isOrgManager,
    isOwner: orgRole === 'owner',
    allowedActions: isOrgManager ? ORG_MANAGER_ACTIONS : MEMBER_ACTIONS,
  };
}
