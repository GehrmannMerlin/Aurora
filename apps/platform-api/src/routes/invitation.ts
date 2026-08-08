import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  findInvitationByDigest,
  findOrganizationById,
  getAccountById,
  insertAuditEvent,
  insertOrganizationMembership,
  updateInvitationStatus,
} from '@aurora/platform-identity';
import { OPERATION_ID_ACCEPT_INVITATION } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { clearIntentCookieOnReply } from '../intent-cookie.js';
import { maskEmail } from '../email-mask.js';
import {
  runIdempotentCommand,
  lookupIdempotency,
  requestDigest,
  type IdempotentCommandResult,
} from '../idempotency.js';
import { ServiceError, sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const ACCEPT_INVITATION_OPERATION: OperationDef = operationById(OPERATION_ID_ACCEPT_INVITATION);

interface AcceptInvitationBody {
  readonly idempotencyKey: string;
}

/** SHA-256 hex digest of a transient intent token (matches platform-identity). */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * POST /api/platform/v1/invitations/accept — A4. Session-authLevel + CSRF
 * (enforced by the plugins) AND a this-visit invitation intent cookie. The
 * server checks: intent valid (pending + unexpired) and the authenticated
 * account's normalized email matches the invited email. Then ATOMICALLY
 * { insertOrganizationMembership + (project memberships) + updateInvitationStatus
 * (accepted) + audit + idempotency }. Email mismatch / missing intent / invalid
 * intent -> 404 with NO org details leaked (the masked invited email is safe to
 * show so the user can switch accounts). The invitation is never auto-accepted
 * on login.
 *
 * Project memberships: the PLT-03 invitation carries no project data and there
 * is no `projects` table yet (B2/PLT-04), so this increment grants the org
 * membership only; the project_members write target exists and is exercised by
 * platform-identity integration tests.
 */
export async function handleAcceptInvitation(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(ACCEPT_INVITATION_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as AcceptInvitationBody;
  const session = request.sessionPayload;
  if (session === null) {
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return;
  }

  const intentPayload = request.intentPayload;
  if (intentPayload?.kind !== 'organization_invitation') {
    await sendProblem(reply, requestId, 404, 'not_found', 'The invitation intent was not found.');
    return;
  }

  let invitation;
  try {
    invitation = await findInvitationByDigest(deps.pool, digestOf(intentPayload.token));
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (invitation === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The invitation was not found.');
    return;
  }

  // Only a pending, unexpired invitation is acceptable (no org details leak).
  const expired = Date.parse(invitation.expiresAt) <= now.getTime();
  if (invitation.status !== 'pending' || expired) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The invitation is no longer valid.');
    return;
  }

  let account;
  try {
    account = await getAccountById(deps.pool, session.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (account === null) {
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return;
  }

  // Email must match the invited email (normalized comparison). On mismatch a
  // 404 with only the masked invited email is returned — never org details.
  if (account.emailNormalized !== invitation.invitedEmail) {
    await sendProblem(
      reply,
      requestId,
      404,
      'not_found',
      `This invitation is addressed to ${maskEmail(invitation.invitedEmail)}.`,
    );
    return;
  }

  const accountId = account.accountId;
  const invitationId = invitation.invitationId;
  const organizationId = invitation.organizationId;
  const orgRole = invitation.orgRole as 'owner' | 'admin' | 'member';

  // Idempotency convergence: probe BEFORE the pending/email pre-checks so a
  // same-key retry after a committed accept returns the replayed first result
  // instead of a misleading 404 (the invitation is no longer pending). The
  // in-transaction pending re-check (runIdempotentCommand.execute) still guards
  // against a concurrent double-accept. Email-match is enforced above for both
  // first-run and replay (the stored result is only returned to the same key).
  const probeDigest = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, probeDigest);
  if (probe.outcome === 'replay') {
    const serialized = serializeOutput(ACCEPT_INVITATION_OPERATION, 200, probe.resultData);
    if (!serialized.ok) {
      await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
      return;
    }
    void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
    return;
  }
  if (probe.outcome === 'conflict') {
    await sendProblem(
      reply,
      requestId,
      409,
      'idempotency_conflict',
      'Idempotency key was used with a different request.',
    );
    return;
  }

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_ACCEPT_INVITATION,
      digest: probeDigest,
      execute: async (client) => {
        // Re-check pending + unexpired inside the transaction so a concurrent
        // accept cannot create a membership from a stale invitation.
        const fresh = await findInvitationByDigest(client, digestOf(intentPayload.token));
        if (fresh?.status !== 'pending' || Date.parse(fresh.expiresAt) <= now.getTime()) {
          throw new ServiceError(404, 'not_found', 'The invitation is no longer valid.');
        }

        const membership = await insertOrganizationMembership(client, {
          organizationId,
          accountId,
          role: orgRole,
        });
        if (membership.status === 'already_member') {
          throw new ServiceError(
            409,
            'business_validation',
            'You are already a member of this organization.',
          );
        }

        // PLT-03 invitation carries no project data (see module doc) — no project
        // membership rows to write in this increment.
        // await insertProjectMembership(client, { projectId, accountId, role });

        await updateInvitationStatus(client, invitationId, 'accepted', now);

        await insertAuditEvent(client, {
          organizationId,
          actorAccountId: accountId,
          action: 'invitation.accepted',
          targetAccountId: accountId,
          details: { role: orgRole },
        });

        const org = await findOrganizationById(client, organizationId);
        if (org === null) {
          throw new ServiceError(404, 'not_found', 'The organization was not found.');
        }

        return {
          organization: { organizationId, name: org.name, role: orgRole },
          navigationTargets: [{ routeId: 'workspace.home', pathParams: {}, query: {} }],
        };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  clearIntentCookieOnReply(reply, deps.cookieOptions);

  const serialized = serializeOutput(ACCEPT_INVITATION_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
