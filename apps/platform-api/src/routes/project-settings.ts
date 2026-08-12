import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  OPERATION_ID_SETTINGS_CREATE_ENVIRONMENT,
  OPERATION_ID_SETTINGS_GET,
  OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS,
  OPERATION_ID_SETTINGS_UPDATE,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  createProjectEnvironment,
  getProjectById,
  listProjectEnvironments,
  updateProjectSettings,
} from '@aurora/platform-project-governance';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
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

const GET_OP = operationById(OPERATION_ID_SETTINGS_GET);
const UPDATE_OP = operationById(OPERATION_ID_SETTINGS_UPDATE);
const LIST_ENVS_OP = operationById(OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS);
const CREATE_ENV_OP = operationById(OPERATION_ID_SETTINGS_CREATE_ENVIRONMENT);

interface SettingsProjectParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/** Session + org membership + project view access (shared by all C15 handlers). */
async function authorizeSettingsView(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<SettingsProjectParams | null> {
  const params = request.params as SettingsProjectParams;
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

/** GET .../settings — project settings + authoritative lifecycle summary (C15). */
export async function handleGetProjectSettings(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_OP, { params: request.params });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeSettingsView(request, reply, deps, requestId);
  if (auth === null) return;

  let project;
  try {
    project = await getProjectById(deps.pool, { orgId: auth.organizationId, projectId: auth.projectId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (project === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'Project not found.');
    return;
  }

  const body = {
    data: {
      project: {
        projectId: project.projectId,
        name: project.name,
        frameworkType: project.frameworkType,
        ...(project.websiteUrl === null ? {} : { websiteUrl: project.websiteUrl }),
        lifecycle: {
          status: project.status,
          ...(project.archivedAt === null ? {} : { archivedAt: project.archivedAt }),
          ...(project.trashedAt === null ? {} : { trashedAt: project.trashedAt }),
          ...(project.recoverableUntil === null ? {} : { recoverableUntil: project.recoverableUntil }),
        },
        resourceVersion: project.updatedAt,
      },
    },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read', 'update'],
    navigationTargets: projectNavigation('project.settings', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(GET_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

interface UpdateSettingsBody {
  readonly name: string;
  readonly websiteUrl?: string;
  readonly resourceVersion: string;
  readonly idempotencyKey: string;
}

/** PATCH .../settings — update name + optional website URL (versioned, C15). */
export async function handleUpdateProjectSettings(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(UPDATE_OP, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeSettingsView(request, reply, deps, requestId);
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
  const body = parsed.data.body as UpdateSettingsBody;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(UPDATE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_SETTINGS_UPDATE,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await updateProjectSettings(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          name: body.name,
          ...(body.websiteUrl === undefined ? {} : { websiteUrl: body.websiteUrl }),
          expectedVersion: body.resourceVersion,
          actorId: session?.accountId ?? '',
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        if (result.status === 'version_conflict') {
          throw new ServiceError(412, 'version_conflict', 'The project settings version is stale.', {
            fieldErrors: [
              { field: 'resourceVersion', reason: `Current version is ${result.currentResourceVersion}.` },
            ],
          });
        }
        if (result.status === 'state_machine_conflict') {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'The project is not in an editable state.',
            { fieldErrors: [{ field: 'status', reason: `Current status is ${result.currentStatus}.` }] },
          );
        }
        return {
          status: 'updated',
          projectId: result.projectId,
          name: result.name,
          ...(result.websiteUrl === null ? {} : { websiteUrl: result.websiteUrl }),
          resourceVersion: result.resourceVersion,
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(UPDATE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** GET .../settings/environments — project environment directory (C15). */
export async function handleListProjectEnvironments(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_ENVS_OP, { params: request.params });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeSettingsView(request, reply, deps, requestId);
  if (auth === null) return;

  let environments;
  try {
    environments = await listProjectEnvironments(deps.pool, {
      orgId: auth.organizationId,
      projectId: auth.projectId,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data:
      environments.length === 0
        ? { status: 'empty' as const, reason: 'no environments' }
        : {
            status: 'available' as const,
            data: {
              items: environments.map((environment) => ({
                environmentId: environment.environmentId,
                name: environment.name,
                isDefault: environment.isDefault,
                createdAt: environment.createdAt,
              })),
            },
          },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.settings', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(LIST_ENVS_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

interface CreateEnvironmentBody {
  readonly name: string;
  readonly idempotencyKey: string;
}

/** POST .../settings/environments — create an immutable environment (C15). */
export async function handleCreateProjectEnvironment(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CREATE_ENV_OP, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeSettingsView(request, reply, deps, requestId);
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
  const body = parsed.data.body as CreateEnvironmentBody;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(CREATE_ENV_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_SETTINGS_CREATE_ENVIRONMENT,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await createProjectEnvironment(client, {
          orgId: auth.organizationId,
          projectId: auth.projectId,
          name: body.name,
          actorId: session?.accountId ?? '',
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The project was not found.');
        }
        if (result.status === 'duplicate') {
          throw new ServiceError(422, 'field_validation', 'An environment with that name already exists.');
        }
        return { status: 'created', environmentId: result.environmentId, name: result.name };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(CREATE_ENV_OP, reply, requestId, idempotency.resultData);
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
