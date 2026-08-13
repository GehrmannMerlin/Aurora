import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { insertAuditEvent } from '@aurora/platform-identity';
import {
  OPERATION_ID_RELEASES_LIST,
  OPERATION_ID_SOURCE_MAPS_LIST,
  OPERATION_ID_SOURCE_MAPS_REPARSE,
  OPERATION_ID_SOURCE_MAPS_REPLACE,
  OPERATION_ID_SOURCE_MAPS_UPLOAD,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  createReparseTask,
  createSourceMapFile,
  getReleaseById,
  getSourceMapFileById,
  listReleases,
  listSourceMapFiles,
  replaceSourceMapFile,
  sourceMapObjectKey,
  upsertRelease,
  type SourceMapFileRow,
} from '@aurora/platform-releases';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import {
  projectNavigation,
  requireProjectAccess,
  requireProjectHandleAccess,
  requireProjectHandleAccessOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_RELEASES_OP = operationById(OPERATION_ID_RELEASES_LIST);
const LIST_FILES_OP = operationById(OPERATION_ID_SOURCE_MAPS_LIST);
const UPLOAD_OP = operationById(OPERATION_ID_SOURCE_MAPS_UPLOAD);
const REPLACE_OP = operationById(OPERATION_ID_SOURCE_MAPS_REPLACE);
const REPARSE_OP = operationById(OPERATION_ID_SOURCE_MAPS_REPARSE);

/** Release/source-map ids are bigint rendered as text; reject non-numeric. */
function requireNumericId(value: unknown, reply: FastifyReply, requestId: string): value is string {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
    sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return false;
  }
  return true;
}

interface SourceMapProjectParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/** Conditionally include the actor field (exactOptionalPropertyTypes-safe). */
function actorField(
  accountId: string | undefined,
): { actorAccountId: string } | Record<string, never> {
  return accountId === undefined ? {} : { actorAccountId: accountId };
}

/** Session + org membership + project view access (shared by all handlers). */
async function authorizeSourceMapView(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<SourceMapProjectParams | null> {
  const params = request.params as SourceMapProjectParams;
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

function toFileSummary(file: SourceMapFileRow): Record<string, unknown> {
  return {
    sourceMapFileId: file.id,
    buildPath: file.buildPath,
    digestPrefix: file.digest.slice(0, 8),
    status: file.status,
    reparse: {
      state: file.reparse.state ?? 'queued',
      processedCount: file.reparse.processedCount,
      totalCount: file.reparse.totalCount,
      updatedAt: file.reparse.updatedAt === null ? undefined : file.reparse.updatedAt.toISOString(),
    },
    uploadedAt: file.uploadedAt.toISOString(),
    replacedAt: file.replacedAt === null ? undefined : file.replacedAt.toISOString(),
    version: file.version,
  };
}

/** GET .../releases — C8 release list (created by authorized source-map uploads). */
export async function handleListReleases(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_RELEASES_OP, { params: request.params });
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
  const auth = await authorizeSourceMapView(request, reply, deps, requestId);
  if (auth === null) return;

  let releases;
  try {
    releases = await listReleases(deps.pool, { projectId: auth.projectId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data:
      releases.length === 0
        ? { status: 'empty' as const, reason: 'no releases yet' }
        : {
            status: 'available' as const,
            data: {
              items: releases.map((r) => ({
                releaseId: r.id,
                version: r.version,
                source: r.source as 'source_map_upload',
                firstSeenAt: r.firstSeenAt.toISOString(),
                sourceMapFileCount: r.sourceMapFileCount,
              })),
            },
          },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.releases', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(LIST_RELEASES_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/** GET .../releases/:releaseId/source-maps — C9 current effective file list. */
export async function handleListSourceMapFiles(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_FILES_OP, { params: request.params });
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
  const params = request.params as SourceMapProjectParams & { releaseId?: string };
  const auth = await authorizeSourceMapView(request, reply, deps, requestId);
  if (auth === null) return;
  if (!requireNumericId(params.releaseId, reply, requestId)) return;

  let files;
  try {
    files = await listSourceMapFiles(deps.pool, {
      projectId: auth.projectId,
      releaseId: params.releaseId,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data:
      files.length === 0
        ? { status: 'empty' as const, reason: 'no source map files for this release' }
        : {
            status: 'available' as const,
            data: { items: files.map(toFileSummary) },
          },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation(
      'project.source-maps',
      auth.organizationId,
      auth.projectId,
    ),
  };

  const serialized = serializeOutput(LIST_FILES_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

interface UploadBody {
  readonly releaseVersion: string;
  readonly buildPath: string;
  readonly content: string;
  readonly digest: string;
  readonly buildId?: string;
  readonly idempotencyKey: string;
}

/** POST .../source-maps — upload (idempotent digest; replace requires explicit confirmation). */
export async function handleUploadSourceMap(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(UPLOAD_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeSourceMapView(request, reply, deps, requestId);
  if (auth === null) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectHandleAccess(
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
  const body = parsed.data.body as UploadBody;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(UPLOAD_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_SOURCE_MAPS_UPLOAD,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const release = await upsertRelease(client, {
          projectId: auth.projectId,
          version: body.releaseVersion,
        });
        const objectKey = sourceMapObjectKey(auth.projectId, randomUUID());
        await deps.sourceMapObjectStorage.putObject({ key: objectKey, content: body.content });
        const result = await createSourceMapFile(client, {
          projectId: auth.projectId,
          releaseId: release.releaseId,
          buildPath: body.buildPath,
          objectKey,
          digest: body.digest,
          ...(body.buildId === undefined ? {} : { buildId: body.buildId }),
        });
        if (result.status === 'duplicate') {
          await deps.sourceMapObjectStorage.deleteObject(objectKey).catch(() => undefined);
          return {
            status: 'duplicate',
            releaseId: release.releaseId,
            sourceMapFileId: result.sourceMapFileId,
          };
        }
        if (result.status === 'replace_conflict') {
          await deps.sourceMapObjectStorage.deleteObject(objectKey).catch(() => undefined);
          return {
            status: 'replace_conflict',
            releaseId: release.releaseId,
            sourceMapFileId: result.sourceMapFileId,
            currentDigest: result.currentDigest,
            version: result.version,
          };
        }
        await createReparseTask(client, {
          projectId: auth.projectId,
          releaseId: release.releaseId,
          sourceMapFileId: result.sourceMapFileId,
        });
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'source_map.uploaded',
          details: {
            projectId: auth.projectId,
            releaseId: release.releaseId,
            sourceMapFileId: result.sourceMapFileId,
            buildPath: body.buildPath,
          },
        });
        return {
          status: 'uploaded',
          releaseId: release.releaseId,
          sourceMapFileId: result.sourceMapFileId,
          version: result.version,
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(UPLOAD_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

interface ReplaceBody {
  readonly content: string;
  readonly digest: string;
  readonly version: number;
  readonly idempotencyKey: string;
}

/** POST .../source-maps/:sourceMapFileId/replace — explicit versioned replacement. */
export async function handleReplaceSourceMap(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(REPLACE_OP, { params: request.params, body: request.body });
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
  const params = request.params as SourceMapProjectParams & {
    releaseId?: string;
    sourceMapFileId?: string;
  };
  const auth = await authorizeSourceMapView(request, reply, deps, requestId);
  if (auth === null) return;
  if (!requireNumericId(params.releaseId, reply, requestId)) return;
  if (!requireNumericId(params.sourceMapFileId, reply, requestId)) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectHandleAccess(
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
  const body = parsed.data.body as ReplaceBody;
  const sourceMapFileId = params.sourceMapFileId;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(REPLACE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_SOURCE_MAPS_REPLACE,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const current = await getSourceMapFileById(client, {
          projectId: auth.projectId,
          sourceMapFileId,
        });
        if (current === null) {
          throw new ServiceError(404, 'not_found', 'The source map file was not found.');
        }
        const objectKey = sourceMapObjectKey(auth.projectId, randomUUID());
        await deps.sourceMapObjectStorage.putObject({ key: objectKey, content: body.content });
        const result = await replaceSourceMapFile(client, {
          projectId: auth.projectId,
          sourceMapFileId,
          objectKey,
          digest: body.digest,
          version: body.version,
        });
        if (result.status === 'version_conflict') {
          await deps.sourceMapObjectStorage.deleteObject(objectKey).catch(() => undefined);
          throw new ServiceError(
            409,
            'version_conflict',
            'The source map was replaced by another member.',
          );
        }
        if (result.status === 'not_found') {
          await deps.sourceMapObjectStorage.deleteObject(objectKey).catch(() => undefined);
          throw new ServiceError(404, 'not_found', 'The source map file was not found.');
        }
        await deps.sourceMapObjectStorage.deleteObject(result.oldObjectKey).catch(() => undefined);
        await createReparseTask(client, {
          projectId: auth.projectId,
          releaseId: current.releaseId,
          sourceMapFileId,
        });
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'source_map.replaced',
          details: {
            projectId: auth.projectId,
            releaseId: current.releaseId,
            sourceMapFileId,
            buildPath: current.buildPath,
          },
        });
        return { status: 'replaced', sourceMapFileId, version: result.version };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(REPLACE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../releases/:releaseId/reparse — queue a bounded reparse for a release. */
export async function handleReparseRelease(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(REPARSE_OP, { params: request.params, body: request.body });
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
  const params = request.params as SourceMapProjectParams & { releaseId?: string };
  const auth = await authorizeSourceMapView(request, reply, deps, requestId);
  if (auth === null) return;
  if (!requireNumericId(params.releaseId, reply, requestId)) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectHandleAccess(
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
  const releaseId = params.releaseId;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(REPARSE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_SOURCE_MAPS_REPARSE,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const release = await getReleaseById(client, {
          projectId: auth.projectId,
          releaseId,
        });
        if (release === null) {
          throw new ServiceError(404, 'not_found', 'The release was not found.');
        }
        const files = await listSourceMapFiles(client, {
          projectId: auth.projectId,
          releaseId,
        });
        if (files.length === 0) {
          throw new ServiceError(422, 'business_validation', 'no source map files to reparse');
        }
        for (const file of files) {
          await createReparseTask(client, {
            projectId: auth.projectId,
            releaseId,
            sourceMapFileId: file.id,
          });
        }
        return { status: 'queued', releaseId, taskCount: files.length };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(REPARSE_OP, reply, requestId, idempotency.resultData);
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
