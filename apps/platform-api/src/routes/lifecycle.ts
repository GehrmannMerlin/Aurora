import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  OPERATION_ID_LIFECYCLE_ARCHIVE,
  OPERATION_ID_LIFECYCLE_MOVE_TO_TRASH,
  OPERATION_ID_LIFECYCLE_RESTORE,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  getProjectById,
  restoreFromArchive,
  trashProject,
  updateProjectStatus,
} from '@aurora/platform-project-governance';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import {
  requireOrgManager,
  requireOrgManagerOnTransaction,
  requireProjectAccess,
  requireProjectAdminAccess,
  requireProjectAdminAccessOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const ARCHIVE_OP = operationById(OPERATION_ID_LIFECYCLE_ARCHIVE);
const RESTORE_OP = operationById(OPERATION_ID_LIFECYCLE_RESTORE);
const TRASH_OP = operationById(OPERATION_ID_LIFECYCLE_MOVE_TO_TRASH);

interface LifecycleProjectParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/** Session + org membership + project view access (shared by all C16 handlers). */
async function authorizeLifecycleView(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<LifecycleProjectParams | null> {
  const params = request.params as LifecycleProjectParams;
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

/** POST .../lifecycle/archive — archive a project (C16, project admin). */
export async function handleArchiveProject(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(ARCHIVE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeLifecycleView(request, reply, deps, requestId);
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
  const body = parsed.data.body as { idempotencyKey: string };

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(ARCHIVE_OP, reply, requestId, probe.resultData);
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

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_LIFECYCLE_ARCHIVE,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await updateProjectStatus(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          actorId: session?.accountId ?? '',
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        if (result.status === 'state_machine_conflict') {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'The project is not in an archivable state.',
            {
              fieldErrors: [
                { field: 'status', reason: `Current status is ${result.currentStatus}.` },
              ],
            },
          );
        }
        return { status: 'archived', projectId: auth.projectId };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(ARCHIVE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../lifecycle/restore — restore an archived project (C16, project admin). */
export async function handleRestoreProjectFromArchive(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(RESTORE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeLifecycleView(request, reply, deps, requestId);
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
  const body = parsed.data.body as { idempotencyKey: string };

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(RESTORE_OP, reply, requestId, probe.resultData);
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

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_LIFECYCLE_RESTORE,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        // Read the authoritative current version, then restore with optimistic
        // concurrency so a concurrent lifecycle change surfaces a conflict.
        const current = await getProjectById(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
        });
        if (current === null) {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        const result = await restoreFromArchive(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          expectedVersion: current.updatedAt,
          actorId: session?.accountId ?? '',
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        if (result.status === 'version_conflict') {
          throw new ServiceError(412, 'version_conflict', 'The project version is stale.');
        }
        if (result.status === 'state_machine_conflict') {
          throw new ServiceError(409, 'state_machine_conflict', 'The project is not archived.', {
            fieldErrors: [
              { field: 'status', reason: `Current status is ${result.currentStatus}.` },
            ],
          });
        }
        return { status: 'restored', projectId: auth.projectId };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(RESTORE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

interface MoveToTrashBody {
  readonly resourceVersion: string;
  readonly idempotencyKey: string;
}

/** POST .../lifecycle/move-to-trash — org manager only; name+version confirmed (C16). */
export async function handleMoveProjectToTrash(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(TRASH_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeLifecycleView(request, reply, deps, requestId);
  if (auth === null) return;
  const session = request.sessionPayload;
  if (session === null) return;
  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, auth.organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgManager(permissions, reply, requestId))) return;
  const body = parsed.data.body as MoveToTrashBody;

  // The current authoritative project version is read so the caller's explicit
  // confirmation (`resourceVersion`) is checked before the destructive move.
  let current;
  try {
    current = await getProjectById(deps.pool, {
      orgId: auth.organizationId,
      projectId: auth.projectId,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (current === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'Project not found.');
    return;
  }
  if (current.updatedAt !== body.resourceVersion) {
    await sendProblem(reply, requestId, 412, 'version_conflict', 'The project version is stale.');
    return;
  }

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(TRASH_OP, reply, requestId, probe.resultData);
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

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_LIFECYCLE_MOVE_TO_TRASH,
      digest,
      execute: async (client) => {
        await requireOrgManagerOnTransaction(client, session.accountId, auth.organizationId);
        const result = await trashProject(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          actorId: session.accountId,
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        if (result.status === 'state_machine_conflict') {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'The project is not in a state that can be moved to the trash.',
            {
              fieldErrors: [
                { field: 'status', reason: `Current status is ${result.currentStatus}.` },
              ],
            },
          );
        }
        return {
          status: 'trashed',
          projectId: auth.projectId,
          trashedAt: result.trashedAt,
          recoverableUntil: result.recoverableUntil,
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(TRASH_OP, reply, requestId, idempotency.resultData);
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
