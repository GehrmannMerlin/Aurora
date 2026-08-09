import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import {
  createIntentToken,
  getAccountById,
  insertOutboxRow,
  normalizeEmail,
} from '@aurora/platform-identity';
import {
  inviteMember,
  listPendingInvitations,
  resendInvitation,
  revokeInvitation,
  type InvitationRow,
} from '@aurora/platform-organization';
import {
  OPERATION_ID_INVITE_MEMBER,
  OPERATION_ID_REVOKE_INVITATION,
  OPERATION_ID_RESEND_INVITATION,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { maskEmail } from '../email-mask.js';
import { effectivePermissions } from '../authorization.js';
import { withTransaction } from '../db.js';
import {
  requireOrgManager,
  requireOrgManagerOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import {
  lookupIdempotency,
  requestDigest,
  runIdempotentCommand,
  type IdempotentCommandResult,
} from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const INVITE_MEMBER_OPERATION: OperationDef = operationById(OPERATION_ID_INVITE_MEMBER);
const REVOKE_INVITATION_OPERATION: OperationDef = operationById(OPERATION_ID_REVOKE_INVITATION);
const RESEND_INVITATION_OPERATION: OperationDef = operationById(OPERATION_ID_RESEND_INVITATION);

/** B3 default invitation lifetime (7 days), matching the data-layer default. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITATION_EXPIRES_MINUTES = 7 * 24 * 60;

interface InviteMemberBody {
  readonly email: string;
  readonly orgRole: 'admin' | 'member';
  readonly projectGrants?: readonly { projectId: string; projectRole: string }[];
  readonly idempotencyKey: string;
}

interface InvitationPathParams {
  readonly organizationId: string;
  readonly invitationId: string;
}

/**
 * POST /api/platform/v1/organizations/:organizationId/invitations — B3 invite a
 * member (owner/admin only, idempotent, CSRF via plugins). PRD §4.1: the ACTOR's
 * email must be verified to invite (line 147: "邮箱未验证时不能邀请成员…"), enforced
 * by reading `accounts.verified_at`. The data layer normalizes the invited email,
 * persists only the one-time token's SHA-256 digest, and rejects
 * `pending_conflict` (a pending invitation already exists for the same
 * org+email) / `already_member`. The handler enqueues the invitation email in
 * the outbox ATOMICALLY with the invitation row + audit (ADR-032); the raw token
 * travels only in the mail link, never in the DB.
 */
export async function handleInviteMember(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(INVITE_MEMBER_OPERATION, {
    params: request.params,
    body: request.body,
  });
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

  const params = request.params as { organizationId?: string };
  if (!requireUuidParams(params, reply, requestId)) {
    return;
  }
  const organizationId = params.organizationId ?? '';
  const input = parsed.data.body as InviteMemberBody;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  // PRD §4.1 verified-email gate for the ACTOR. 403 authorization: the capability
  // is unavailable while the actor's own email is unverified (the actor is the
  // account owner, so this reveals no third-party state).
  let actorAccount;
  try {
    actorAccount = await getAccountById(deps.pool, session.accountId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (actorAccount?.verifiedAt == null) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'A verified email is required to invite members.',
    );
    return;
  }

  const invitedEmail = normalizeEmail(input.email);
  const { token, digest } = createIntentToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const masked = maskEmail(invitedEmail);

  const digestKey = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, digestKey);
  if (probe.outcome === 'replay') {
    const serialized = serializeOutput(INVITE_MEMBER_OPERATION, 200, probe.resultData);
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
      operation: OPERATION_ID_INVITE_MEMBER,
      digest: digestKey,
      execute: async (client) => {
        await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
        const result = await inviteMember(client, {
          orgId: organizationId,
          invitedEmail: input.email,
          orgRole: input.orgRole,
          tokenDigest: digest,
          expiresAt,
          actorId: session.accountId,
        });
        if (result.status === 'pending_conflict') {
          throw new ServiceError(
            409,
            'business_validation',
            'A pending invitation already exists for this email.',
          );
        }
        if (result.status === 'already_member') {
          throw new ServiceError(
            409,
            'business_validation',
            'This email already belongs to an organization member.',
          );
        }

        const base = deps.config.consoleOrigin.replace(/\/$/, '');
        await insertOutboxRow(client, {
          aggregateType: 'email.invitation',
          aggregateId: result.invitationId,
          payload: {
            intentType: 'organization_invitation',
            toAddress: invitedEmail,
            toMasked: masked,
            mailLinkUrl: `${base}/invitations/accept?token=${token}`,
            expiresInMinutes: INVITATION_EXPIRES_MINUTES,
          },
        });

        return {
          invitationId: result.invitationId,
          invitedEmailMasked: masked,
          expiresAt: result.expiresAt,
          status: 'pending' as const,
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

  const serialized = serializeOutput(INVITE_MEMBER_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/invitations/:invitationId/revoke —
 * B3 revoke a pending invitation (owner/admin only). Org scoping is enforced at
 * the service layer: the invitation must appear in THIS organization's pending
 * list, else 404 not_found (a cross-org or non-pending invitation is never
 * revealed). The data layer writes the `organization.invitation.revoked` audit
 * row in the same transaction. `invitationId` is validated as a UUID before it
 * reaches SQL.
 */
export async function handleRevokeInvitation(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(REVOKE_INVITATION_OPERATION, { params: request.params });
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

  const params = request.params as InvitationPathParams;
  if (
    !requireUuidParams(params as unknown as Readonly<Record<string, unknown>>, reply, requestId)
  ) {
    return;
  }
  const organizationId = params.organizationId;
  const invitationId = params.invitationId;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  try {
    await withTransaction(deps.pool, async (client) => {
      await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
      await assertPendingInvitationInOrg(client, organizationId, invitationId);
      const result = await revokeInvitation(client, {
        invitationId,
        actorId: session.accountId,
      });
      if (result.status === 'not_found') {
        throw new ServiceError(404, 'not_found', 'The invitation was not found.');
      }
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = { status: 'succeeded' as const, invitationId };
  const serialized = serializeOutput(REVOKE_INVITATION_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/invitations/:invitationId/resend —
 * B3 resend a pending invitation (owner/admin only): the data layer replaces the
 * token digest with a freshly generated one and resets the expiry; the handler
 * enqueues a fresh invitation email (new outbox row with the new raw token)
 * atomically. Org scoping enforced via the org's pending list (404 otherwise).
 */
export async function handleResendInvitation(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(RESEND_INVITATION_OPERATION, { params: request.params });
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

  const params = request.params as InvitationPathParams;
  if (
    !requireUuidParams(params as unknown as Readonly<Record<string, unknown>>, reply, requestId)
  ) {
    return;
  }
  const organizationId = params.organizationId;
  const invitationId = params.invitationId;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  let result;
  try {
    result = await withTransaction(deps.pool, async (client) => {
      await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
      const invitation = await assertPendingInvitationInOrg(client, organizationId, invitationId);
      const resent = await resendInvitation(client, {
        invitationId,
        actorId: session.accountId,
      });
      if (resent.status === 'not_found') {
        throw new ServiceError(404, 'not_found', 'The invitation was not found.');
      }
      const base = deps.config.consoleOrigin.replace(/\/$/, '');
      await insertOutboxRow(client, {
        aggregateType: 'email.invitation',
        aggregateId: invitationId,
        payload: {
          intentType: 'organization_invitation',
          toAddress: invitation.invitedEmail,
          toMasked: maskEmail(invitation.invitedEmail),
          mailLinkUrl: `${base}/invitations/accept?token=${resent.token}`,
          expiresInMinutes: INVITATION_EXPIRES_MINUTES,
        },
      });
      return {
        invitationId,
        expiresAt: resent.expiresAt,
      };
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = { status: 'succeeded' as const, invitationId, expiresAt: result.expiresAt };
  const serialized = serializeOutput(RESEND_INVITATION_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * Org-scoping guard for revoke/resend: the invitation must be one of THIS
 * organization's pending invitations, else 404 not_found. Reads the org-scoped
 * pending list (the only org-scoped invitation read the data layer exposes) so a
 * cross-org invitation id is never confirmed or mutated. Returns the matching
 * invitation row for the caller (e.g. resend uses its invited email).
 */
async function assertPendingInvitationInOrg(
  client: PoolClient,
  orgId: string,
  invitationId: string,
): Promise<InvitationRow> {
  const pending = await listPendingInvitations(client, orgId);
  const match = pending.find((row) => row.invitationId === invitationId);
  if (match === undefined) {
    throw new ServiceError(404, 'not_found', 'The invitation was not found.');
  }
  return match;
}
