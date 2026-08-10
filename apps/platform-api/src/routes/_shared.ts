import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import type { SessionPayload } from '@aurora/platform-session';
import type { RouteTargetId } from '@aurora/platform-contract';
import { checkProjectAccess, getProjectAccessRole } from '@aurora/platform-project-governance';
import { effectivePermissions, type EffectivePermissions } from '../authorization.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

/**
 * Canonical UUID shape. The contract's branded-id schemas are length-bounded
 * strings, not uuid-typed, so malformed path ids must be rejected here before
 * they reach PostgreSQL (spec §13 / ADR-029). Exported so 6C body id fields
 * (e.g. `transferOwnership.newOwnerAccountId`) are validated as UUIDs before
 * they reach a `WHERE account_id = $n` predicate (a non-UUID would surface as a
 * Postgres cast error instead of a clean 400 structural_error).
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One entry of the contract `navigationTargets` array (closed Route Target). */
export interface OrgNavigationTarget {
  readonly routeId: RouteTargetId;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

/**
 * Require a valid authoritative session for a B-route handler. Mirrors the
 * PLT-03 cookie-session plugin semantics: a Redis-unavailable authority fails
 * closed with 503 authority_unavailable, and a missing/expired/revoked session
 * returns a unified 401 authentication with a safe login recovery target.
 *
 * Returns the resolved session payload, or null when a problem was already sent.
 */
export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  requestId: string,
): Promise<SessionPayload | null> {
  if (request.sessionUnavailable) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return null;
  }
  if (request.sessionPayload === null) {
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return null;
  }
  return request.sessionPayload;
}

/**
 * Require org manager permission (owner or admin) for a B-route handler.
 * Returns true when allowed; otherwise sends 403 authorization and returns
 * false. The manager-only operations are B2 create-project, B3 members/
 * invitations, B4 settings, B6 tokens, B7 audit and B8 trash (spec §6).
 */
export async function requireOrgManager(
  permissions: EffectivePermissions,
  reply: FastifyReply,
  requestId: string,
): Promise<boolean> {
  if (!permissions.isOrgManager) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to perform this action.',
    );
    return false;
  }
  return true;
}

/**
 * Require org owner permission for a B-route handler (e.g. transfer ownership).
 * Returns true when allowed; otherwise sends 403 authorization and returns
 * false.
 */
export async function requireOrgOwner(
  permissions: EffectivePermissions,
  reply: FastifyReply,
  requestId: string,
): Promise<boolean> {
  if (!permissions.isOwner) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to perform this action.',
    );
    return false;
  }
  return true;
}

/**
 * Validate every string path parameter as a canonical UUID. The contract's
 * branded-id schemas are length-bounded strings (not uuid-typed), so malformed
 * ids must be rejected before reaching PostgreSQL. Returns true when every
 * string param is a canonical UUID; otherwise sends 400 structural_error and
 * returns false.
 */
export function requireUuidParams(
  params: Readonly<Record<string, unknown>>,
  reply: FastifyReply,
  requestId: string,
): boolean {
  for (const value of Object.values(params)) {
    if (typeof value === 'string' && !UUID_PATTERN.test(value)) {
      sendProblem(
        reply,
        requestId,
        400,
        'structural_error',
        'Request does not match the public contract.',
      );
      return false;
    }
  }
  return true;
}

/**
 * Build the org-scoped `navigationTargets` array for a B-page response: a
 * single closed Route Target carrying the current organization in its path
 * params (spec §5.2 / contract `navigationTargets`).
 */
export function orgNavigation(
  routeId: RouteTargetId,
  organizationId: string,
): readonly OrgNavigationTarget[] {
  return [{ routeId, pathParams: { organizationId }, query: {} }];
}

/**
 * Build the project-scoped `navigationTargets` array for a project query
 * response (DAT-16): a single closed Route Target carrying the current
 * organization AND project in its path params (contract `navigationTargets`).
 */
export function projectNavigation(
  routeId: RouteTargetId,
  organizationId: string,
  projectId: string,
): readonly OrgNavigationTarget[] {
  return [{ routeId, pathParams: { organizationId, projectId }, query: {} }];
}

/**
 * Require project-scoped view access for a project-scoped query handler
 * (DAT-16, spec §6). `checkProjectAccess` enforces the full privilege model in
 * one place: an org manager (owner/admin) of the project's org is allowed
 * regardless of a `project_members` row; any other org member must hold a
 * `project_members` row for the project. It is called for EVERY caller (no
 * org-manager short-circuit): the manager privilege is scoped to the path org,
 * so a manager of org B must still get `not_found` for a project that belongs
 * to org A — a short-circuit would leak another org's project data.
 * `not_found` → closed 404 (an absent project AND a project owned by a
 * different org both map here, so project existence is never leaked);
 * `forbidden` → closed 403. A data-layer failure is mapped via `sendMappedError`
 * (503 authority_unavailable for DB down). Returns true when access is allowed;
 * otherwise a problem was already sent.
 */
export async function requireProjectAccess(
  permissions: EffectivePermissions,
  accountId: string,
  organizationId: string,
  projectId: string,
  deps: PlatformApiRouteDependencies,
  reply: FastifyReply,
  requestId: string,
): Promise<boolean> {
  void permissions;
  let result;
  try {
    result = await checkProjectAccess(deps.pool, { organizationId, projectId, accountId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return false;
    throw error;
  }
  if (result.outcome === 'not_found') {
    await sendProblem(reply, requestId, 404, 'not_found', 'Project not found.');
    return false;
  }
  if (result.outcome === 'forbidden') {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to view this project.',
    );
    return false;
  }
  return true;
}

/**
 * Require project-scoped Issue-handle capability for a DAT-14 Command (spec §4):
 * an org manager or a `project_members` row with role `project_admin`/`developer`
 * may handle; `read_only` and non-members get a closed 403. Cross-org / absent
 * project -> closed 404 (no existence leak). Returns true when allowed; otherwise
 * a problem was already sent.
 */
export async function requireProjectHandleAccess(
  accountId: string,
  organizationId: string,
  projectId: string,
  deps: PlatformApiRouteDependencies,
  reply: FastifyReply,
  requestId: string,
): Promise<boolean> {
  let result;
  try {
    result = await getProjectAccessRole(deps.pool, { organizationId, projectId, accountId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return false;
    throw error;
  }
  if (result.outcome === 'not_found') {
    await sendProblem(reply, requestId, 404, 'not_found', 'Project not found.');
    return false;
  }
  if (result.outcome === 'forbidden' || result.role === 'read_only') {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to handle issues in this project.',
    );
    return false;
  }
  return true;
}

/**
 * Re-read the actor's organization membership on the command's transaction and
 * reject with a closed 403 unless they are still an org manager (spec §13 fresh
 * re-reads). Closes the TOCTOU window between the handler's outer
 * `effectivePermissions` check and the command's writes so a demoted/removed
 * manager cannot win it. Throws a ServiceError so the whole command transaction
 * (including any idempotency record) rolls back. B2/B4 (and 6C commands) reuse
 * this on their command transaction.
 */
export async function requireOrgManagerOnTransaction(
  client: PoolClient,
  accountId: string,
  organizationId: string,
): Promise<void> {
  const fresh = await effectivePermissions(accountId, organizationId, { pool: client });
  if (!fresh.isOrgManager) {
    throw new ServiceError(
      403,
      'authorization',
      'You do not have permission to perform this action.',
    );
  }
}
