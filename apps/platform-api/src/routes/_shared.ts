import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionPayload } from '@aurora/platform-session';
import type { RouteTargetId } from '@aurora/platform-contract';
import type { EffectivePermissions } from '../authorization.js';
import { sendProblem } from '../error-mapper.js';

/**
 * Canonical UUID shape. The contract's branded-id schemas are length-bounded
 * strings, not uuid-typed, so malformed path ids must be rejected here before
 * they reach PostgreSQL (spec §13 / ADR-029).
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
