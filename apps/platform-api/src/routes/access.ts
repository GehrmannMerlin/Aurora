import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  OPERATION_ID_ACCESS_CHANGE_ROLE,
  OPERATION_ID_ACCESS_GRANT,
  OPERATION_ID_ACCESS_LIST,
  OPERATION_ID_ACCESS_REMOVE,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  changeProjectMemberRole,
  insertProjectMember,
  listProjectEffectiveMembers,
  removeProjectMember,
} from '@aurora/platform-project-governance';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import { maskEmail } from '../email-mask.js';
import {
  projectNavigation,
  requireProjectAccess,
  requireProjectAdminAccess,
  requireProjectAdminAccessOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_OP = operationById(OPERATION_ID_ACCESS_LIST);
const GRANT_OP = operationById(OPERATION_ID_ACCESS_GRANT);
const CHANGE_OP = operationById(OPERATION_ID_ACCESS_CHANGE_ROLE);
const REMOVE_OP = operationById(OPERATION_ID_ACCESS_REMOVE);

interface AccessProjectParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/** Session + org membership + project view access (shared by all C13 handlers). */
async function authorizeAccessView(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<AccessProjectParams | null> {
  const params = request.params as AccessProjectParams;
  if (
    !requireUuidParams(
      { organizationId: params.organizationId, projectId: params.projectId },
      reply,
      requestId,
    )
  ) {
    return null;
  }
  const session = await requireSession(request, reply, requestId);
  if (session === null) return null;
  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, params.organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return null;
    throw error;
  }
  if (permissions.orgRole === null) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to access this organization.',
    );
    return null;
  }
  if (
    !(await requireProjectAccess(
      permissions,
      session.accountId,
      params.organizationId,
      params.projectId,
      deps,
      reply,
      requestId,
    ))
  ) {
    return null;
  }
  return { organizationId: params.organizationId, projectId: params.projectId };
}

/** GET .../access — effective per-person access projection (C13). */
export async function handleListEffectiveMembers(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_OP, { params: request.params });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeAccessView(request, reply, deps, requestId);
  if (auth === null) return;

  let members;
  try {
    members = await listProjectEffectiveMembers(deps.pool, {
      orgId: auth.organizationId,
      projectId: auth.projectId,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data:
      members.length === 0
        ? { status: 'empty' as const, reason: 'no effective project members' }
        : {
            status: 'available' as const,
            data: {
              items: members.map((member) => ({
                accountId: member.accountId,
                maskedEmail: maskEmail(member.email),
                effectiveRole: member.effectiveRole,
                sources: member.sources,
                ...(member.projectRole === undefined
                  ? {}
                  : { projectRole: member.projectRole }),
                allowedActions:
                  member.effectiveRole === 'project_admin'
                    ? (['read', 'manage'] as const)
                    : (['read'] as const),
              })),
            },
          },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.access', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(LIST_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/** POST .../access/members — grant a project role to a current org member (C13). */
export async function handleGrantProjectMembership(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GRANT_OP, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeAccessView(request, reply, deps, requestId);
  if (auth === null) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectAdminAccess(
      session?.accountId ?? '',
      auth.organizationId,
      auth.projectId,
      deps,
      reply,
      requestId,
    ))
  ) {
    return;
  }
  const body = parsed.data.body as {
    accountId: string;
    role: 'project_admin' | 'developer' | 'read_only';
    idempotencyKey: string;
  };

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(GRANT_OP, reply, requestId, probe.resultData);
    return;
  }
  if (probe.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key was used with a different request.');
    return;
  }

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_ACCESS_GRANT,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await insertProjectMember(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          accountId: body.accountId,
          role: body.role,
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project or account was not found.');
        }
        if (result.status === 'already_member') {
          throw new ServiceError(
            422,
            'business_validation',
            'The account is already a project member.',
          );
        }
        return { status: 'granted', accountId: body.accountId, role: body.role };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(GRANT_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../access/members/:accountId/role — change an explicit role (C13). */
export async function handleChangeProjectRole(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CHANGE_OP, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const params = request.params as AccessProjectParams & { accountId?: string };
  const auth = await authorizeAccessView(request, reply, deps, requestId);
  if (auth === null) return;
  if (params.accountId === undefined || !/^[0-9a-f-]{36}$/i.test(params.accountId)) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const session = request.sessionPayload;
  if (
    !(await requireProjectAdminAccess(
      session?.accountId ?? '',
      auth.organizationId,
      auth.projectId,
      deps,
      reply,
      requestId,
    ))
  ) {
    return;
  }
  const body = parsed.data.body as {
    role: 'project_admin' | 'developer' | 'read_only';
    idempotencyKey: string;
  };
  const accountId = params.accountId;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(CHANGE_OP, reply, requestId, probe.resultData);
    return;
  }
  if (probe.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key was used with a different request.');
    return;
  }

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_ACCESS_CHANGE_ROLE,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await changeProjectMemberRole(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          accountId,
          role: body.role,
          actorId: session?.accountId ?? '',
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project member was not found.');
        }
        return { status: 'changed', accountId, role: body.role };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(CHANGE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../access/members/:accountId/remove — remove explicit membership (C13). */
export async function handleRemoveProjectMembership(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(REMOVE_OP, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const params = request.params as AccessProjectParams & { accountId?: string };
  const auth = await authorizeAccessView(request, reply, deps, requestId);
  if (auth === null) return;
  if (params.accountId === undefined || !/^[0-9a-f-]{36}$/i.test(params.accountId)) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const session = request.sessionPayload;
  if (
    !(await requireProjectAdminAccess(
      session?.accountId ?? '',
      auth.organizationId,
      auth.projectId,
      deps,
      reply,
      requestId,
    ))
  ) {
    return;
  }
  const body = parsed.data.body as { idempotencyKey: string };
  const accountId = params.accountId;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(REMOVE_OP, reply, requestId, probe.resultData);
    return;
  }
  if (probe.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key was used with a different request.');
    return;
  }

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_ACCESS_REMOVE,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await removeProjectMember(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          accountId,
          actorId: session?.accountId ?? '',
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project member was not found.');
        }
        return { status: 'removed', accountId, remainingSources: result.remainingSources };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(REMOVE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** Serialize a command response; used for both first-run and idempotent replay. */
async function sendSerialized(
  operation: OperationDef,
  reply: FastifyReply,
  requestId: string,
  data: unknown,
): Promise<void> {
  const serialized = serializeOutput(operation, 200, { data });
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
