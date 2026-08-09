import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  changeOrganizationRole,
  getOrganizationById,
  listMembers,
  removeMember,
  transferOwnership,
  type MemberRow,
} from '@aurora/platform-organization';
import {
  OPERATION_ID_LIST_MEMBERS,
  OPERATION_ID_CHANGE_ROLE,
  OPERATION_ID_REMOVE_MEMBER,
  OPERATION_ID_TRANSFER_OWNERSHIP,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { maskEmail } from '../email-mask.js';
import { effectivePermissions } from '../authorization.js';
import { withTransaction } from '../db.js';
import {
  orgNavigation,
  requireOrgManager,
  requireOrgManagerOnTransaction,
  requireOrgOwner,
  requireSession,
  requireUuidParams,
  UUID_PATTERN,
} from './_shared.js';
import {
  lookupIdempotency,
  requestDigest,
  runIdempotentCommand,
  type IdempotentCommandResult,
} from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_MEMBERS_OPERATION: OperationDef = operationById(OPERATION_ID_LIST_MEMBERS);
const CHANGE_ROLE_OPERATION: OperationDef = operationById(OPERATION_ID_CHANGE_ROLE);
const REMOVE_MEMBER_OPERATION: OperationDef = operationById(OPERATION_ID_REMOVE_MEMBER);
const TRANSFER_OWNERSHIP_OPERATION: OperationDef = operationById(OPERATION_ID_TRANSFER_OWNERSHIP);

interface ChangeRoleBody {
  readonly orgRole: 'admin' | 'member';
  readonly resourceVersion: string;
}

interface TransferOwnershipBody {
  readonly newOwnerAccountId: string;
  readonly idempotencyKey: string;
}

/**
 * GET /api/platform/v1/organizations/:organizationId/members — B3 member list
 * (owner/admin only; a plain member gets a closed 403 with no member-list leak,
 * spec §6). Emails are ALWAYS masked (`emailMasked`): the data layer returns the
 * full `accounts.email`, so the handler projects `a***@domain` and the full
 * address never reaches the browser (ADR-031). CSRF-free GET.
 */
export async function handleListMembers(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(LIST_MEMBERS_OPERATION, { params: request.params });
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
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';

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

  let members: MemberRow[];
  try {
    members = await listMembers(deps.pool, organizationId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = {
    members: members.map((member) => ({
      accountId: member.accountId,
      emailMasked: maskEmail(member.email),
      orgRole: member.role,
      joinedAt: member.createdAt,
    })),
    navigationTargets: orgNavigation('organization.members', organizationId),
  };

  const serialized = serializeOutput(LIST_MEMBERS_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/members/:accountId/role —
 * B3 change a member's role (owner/admin only). The contract enum is
 * `['admin','member']` — the owner role is never reachable through this command;
 * ownership only changes via TransferOwnership. The data layer enforces the
 * owner-unique invariant (org row lock) and rejects `owner_derote_not_allowed`
 * (demoting an owner) / `owner_change_not_allowed` (promoting to owner), which
 * the handler maps to 409 business_validation.
 *
 * `resourceVersion`: the contract requires an opaque `str(1,64)` version token,
 * but the PLT-03 `organization_members` schema has NO per-member version column
 * (and the members list exposes none), so this command cannot enforce per-member
 * optimistic concurrency at the data layer. The service layer accepts the
 * client's token (structural validation via parseInput only) and returns the
 * organization's current `settings_version` as a stable, monotonic response
 * version token (consistent with the B4 response semantics). This is a
 * documented adaptation for the data-layer/contract version mismatch; the
 * owner-invariant is still enforced transactionally by the data layer.
 */
export async function handleChangeRole(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(CHANGE_ROLE_OPERATION, { params: request.params, body: request.body });
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

  const params = request.params as { organizationId?: string; accountId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const targetAccountId = params.accountId ?? '';
  const input = parsed.data.body as ChangeRoleBody;

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
      const changed = await changeOrganizationRole(client, {
        orgId: organizationId,
        accountId: targetAccountId,
        newRole: input.orgRole,
        actorId: session.accountId,
      });
      if (changed.status !== 'success') return changed;
      const org = await getOrganizationById(client, organizationId);
      return {
        status: 'success' as const,
        toRole: changed.toRole,
        settingsVersion: org?.settingsVersion ?? 0,
      };
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (result.status === 'not_found') {
    await sendProblem(reply, requestId, 404, 'not_found', 'The member was not found.');
    return;
  }
  if (
    result.status === 'owner_derote_not_allowed' ||
    result.status === 'owner_change_not_allowed'
  ) {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The organization owner role cannot be changed through this command.',
    );
    return;
  }

  const data = {
    accountId: targetAccountId,
    orgRole: result.toRole,
    resourceVersion: String(result.settingsVersion),
  };

  const serialized = serializeOutput(CHANGE_ROLE_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/members/:accountId/remove —
 * B3 remove a member (owner/admin only). Removing the last (only) owner is
 * blocked by the data layer (`last_owner_removal_blocked`) so the
 * exactly-one-owner invariant is never broken; the handler maps that to 409
 * business_validation. `resourceVersion` is treated as an opaque token (no
 * per-member version in the schema; see handleChangeRole).
 */
export async function handleRemoveMember(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(REMOVE_MEMBER_OPERATION, {
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

  const params = request.params as { organizationId?: string; accountId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const targetAccountId = params.accountId ?? '';

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
      return removeMember(client, {
        orgId: organizationId,
        accountId: targetAccountId,
        actorId: session.accountId,
      });
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (result.status === 'not_found') {
    await sendProblem(reply, requestId, 404, 'not_found', 'The member was not found.');
    return;
  }
  if (result.status === 'last_owner_removal_blocked') {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The last organization owner cannot be removed.',
    );
    return;
  }

  const data = { status: 'succeeded' as const, accountId: targetAccountId };
  const serialized = serializeOutput(REMOVE_MEMBER_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/ownership — B3 transfer
 * the single owner role (owner only, idempotent). The data layer locks the org
 * row plus both member rows and verifies exactly one owner post-commit; the
 * handler maps `owner_invariant_violation` → 409 business_validation and
 * `already_owner` → 409 business_validation. Same key + same request replays the
 * stored first result (no duplicate transfer); same key + different request →
 * 409 idempotency_conflict. Every command re-reads the actor's membership
 * in-transaction.
 */
export async function handleTransferOwnership(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(TRANSFER_OWNERSHIP_OPERATION, {
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
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const input = parsed.data.body as TransferOwnershipBody;

  // The body `newOwnerAccountId` must be a canonical UUID before it reaches a
  // `WHERE account_id = $n` predicate (a non-UUID would surface as a Postgres
  // cast error instead of a clean 400 structural_error).
  if (!UUID_PATTERN.test(input.newOwnerAccountId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgOwner(permissions, reply, requestId))) return;

  const digest = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    const serialized = serializeOutput(TRANSFER_OWNERSHIP_OPERATION, 200, probe.resultData);
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
      operation: OPERATION_ID_TRANSFER_OWNERSHIP,
      digest,
      execute: async (client) => {
        await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
        const result = await transferOwnership(client, {
          orgId: organizationId,
          currentOwnerId: session.accountId,
          newOwnerId: input.newOwnerAccountId,
          actorId: session.accountId,
        });
        if (result.status === 'not_found') {
          throw new ServiceError(
            404,
            'not_found',
            'The organization or target member was not found.',
          );
        }
        if (result.status === 'already_owner' || result.status === 'owner_invariant_violation') {
          throw new ServiceError(
            409,
            'business_validation',
            'The organization owner role cannot be transferred that way.',
          );
        }
        const org = await getOrganizationById(client, organizationId);
        return {
          organizationId,
          ownerAccountId: result.newOwnerId,
          resourceVersion: String(org?.settingsVersion ?? 0),
          navigationTargets: orgNavigation('organization.members', organizationId),
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

  const serialized = serializeOutput(TRANSFER_OWNERSHIP_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
