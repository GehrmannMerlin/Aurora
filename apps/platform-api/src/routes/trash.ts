import type { FastifyReply, FastifyRequest } from 'fastify';
import { listTrash, restoreProject, type ProjectRow } from '@aurora/platform-project-governance';
import { OPERATION_ID_LIST_TRASH, OPERATION_ID_RESTORE_PROJECT } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import {
  orgNavigation,
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

const LIST_TRASH_OPERATION: OperationDef = operationById(OPERATION_ID_LIST_TRASH);
const RESTORE_PROJECT_OPERATION: OperationDef = operationById(OPERATION_ID_RESTORE_PROJECT);

interface RestoreProjectBody {
  readonly resourceVersion: string;
  readonly idempotencyKey: string;
}

interface RestorePathParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/**
 * GET /api/platform/v1/organizations/:organizationId/trash — B8 list recoverable
 * trashed projects (owner/admin only; does NOT depend on pre-delete project
 * roles, spec §6 B8). The data layer already filters `status = 'trash'`, so the
 * projection is `lifecycle: 'trash'` with the recovery window.
 */
export async function handleListTrash(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(LIST_TRASH_OPERATION, { params: request.params });
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

  let projects: ProjectRow[];
  try {
    projects = await listTrash(deps.pool, organizationId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = {
    projects: projects.map((project) => ({
      projectId: project.projectId,
      name: project.name,
      frameworkType: project.frameworkType,
      // listTrash returns only status='trash' rows, so trashedAt/recoverableUntil
      // are always set; a defensive fallback never reaches the contract.
      trashedAt: project.trashedAt ?? project.updatedAt,
      recoverableUntil: project.recoverableUntil ?? project.updatedAt,
      lifecycle: 'trash' as const,
    })),
    navigationTargets: orgNavigation('organization.trash', organizationId),
  };

  const serialized = serializeOutput(LIST_TRASH_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/trash/:projectId/restore —
 * B8 restore a trashed project within the recovery window (owner/admin only,
 * idempotent + versioned + CSRF via plugins). Executes the G10 APPROVED restore
 * safety rules at the data layer (alerts not auto-restarted, revoked tokens /
 * disabled keys not restored, membership recomputed against current org state,
 * no resurrection of deletion cleanup). Data-layer results map to:
 * - `version_conflict` → 412 version_conflict (carries the current version);
 * - `state_machine_conflict` → 409 state_machine_conflict (expired window or
 *   `deleting`/`deleted`; carries the current status);
 * - `not_found` → 404.
 * Because a failed restore must NOT create a success idempotency record, the
 * handler throws a ServiceError inside the command transaction (rolling it
 * back), which sendMappedError turns into the problem response.
 */
export async function handleRestoreProject(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(RESTORE_PROJECT_OPERATION, {
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

  const params = request.params as RestorePathParams;
  if (
    !requireUuidParams(params as unknown as Readonly<Record<string, unknown>>, reply, requestId)
  ) {
    return;
  }
  const organizationId = params.organizationId;
  const projectId = params.projectId;
  const input = parsed.data.body as RestoreProjectBody;

  // The restore `resourceVersion` is the project's `updated_at` ISO key. Validate
  // it parses before it reaches the data layer's `isoVersionKey` (an invalid
  // string would throw a RangeError inside the SQL comparison instead of a clean
  // structural 400).
  const versionParsed = new Date(input.resourceVersion);
  if (Number.isNaN(versionParsed.getTime())) {
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
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  const digest = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    const serialized = serializeOutput(RESTORE_PROJECT_OPERATION, 200, probe.resultData);
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
      operation: OPERATION_ID_RESTORE_PROJECT,
      digest,
      execute: async (client) => {
        await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
        const result = await restoreProject(client, {
          orgId: organizationId,
          projectId,
          resourceVersion: input.resourceVersion,
          actorId: session.accountId,
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        if (result.status === 'version_conflict') {
          throw new ServiceError(412, 'version_conflict', 'The project version is stale.', {
            fieldErrors: [
              {
                field: 'resourceVersion',
                reason: `Current version is ${result.currentResourceVersion}.`,
              },
            ],
          });
        }
        if (result.status === 'state_machine_conflict') {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'The project is not in a recoverable state.',
            {
              fieldErrors: [
                { field: 'status', reason: `Current status is ${result.currentStatus}.` },
              ],
            },
          );
        }
        return {
          projectId,
          status: 'active' as const,
          lifecycle: 'active' as const,
          navigationTargets: orgNavigation('organization.trash', organizationId),
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

  const serialized = serializeOutput(RESTORE_PROJECT_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
