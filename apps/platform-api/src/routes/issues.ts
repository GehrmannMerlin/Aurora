import type { FastifyReply, FastifyRequest } from 'fastify';
import { insertAuditEvent } from '@aurora/platform-identity';
import {
  OPERATION_ID_BATCH_UPDATE_ISSUES,
  OPERATION_ID_CREATE_ISSUE_NOTE,
  OPERATION_ID_DELETE_ISSUE_NOTE,
  OPERATION_ID_MERGE_ISSUES,
  OPERATION_ID_UPDATE_ISSUE_ASSIGNEE,
  OPERATION_ID_UPDATE_ISSUE_PRIORITY,
  OPERATION_ID_UPDATE_ISSUE_STATE,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  batchUpdateIssues,
  createIssueNote,
  deleteIssueNote,
  mergeIssues,
  persistNotification,
  updateIssueAssignee,
  updateIssuePriority,
  updateIssueState,
} from '@aurora/processing-store';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import {
  requireProjectAccess,
  requireProjectHandleAccess,
  requireProjectHandleAccessOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import { getProjectAccessRole } from '@aurora/platform-project-governance';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const UPDATE_STATE_OP = operationById(OPERATION_ID_UPDATE_ISSUE_STATE);
const UPDATE_ASSIGNEE_OP = operationById(OPERATION_ID_UPDATE_ISSUE_ASSIGNEE);
const UPDATE_PRIORITY_OP = operationById(OPERATION_ID_UPDATE_ISSUE_PRIORITY);
const CREATE_NOTE_OP = operationById(OPERATION_ID_CREATE_ISSUE_NOTE);
const DELETE_NOTE_OP = operationById(OPERATION_ID_DELETE_ISSUE_NOTE);
const MERGE_OP = operationById(OPERATION_ID_MERGE_ISSUES);
const BATCH_OP = operationById(OPERATION_ID_BATCH_UPDATE_ISSUES);

/** Conditionally include the actor field (exactOptionalPropertyTypes-safe). */
function actorField(
  accountId: string | undefined,
): { actorAccountId: string } | Record<string, never> {
  return accountId === undefined ? {} : { actorAccountId: accountId };
}

/** Issue ids are bigint rendered as text; reject non-numeric before PostgreSQL. */
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

interface IssuePathParams {
  readonly organizationId: string;
  readonly projectId: string;
  readonly issueId: string;
  readonly noteId?: string;
}

async function authorizeIssueCommand(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<{ organizationId: string; projectId: string; issueId: string } | null> {
  const params = request.params as IssuePathParams;
  if (
    !requireUuidParams(
      { organizationId: params.organizationId, projectId: params.projectId },
      reply,
      requestId,
    )
  ) {
    return null;
  }
  if (!requireNumericId(params.issueId, reply, requestId)) return null;
  const organizationId = params.organizationId;
  const projectId = params.projectId;
  const session = await requireSession(request, reply, requestId);
  if (session === null) return null;

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
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
      organizationId,
      projectId,
      deps,
      reply,
      requestId,
    )) ||
    !(await requireProjectHandleAccess(
      session.accountId,
      organizationId,
      projectId,
      deps,
      reply,
      requestId,
    ))
  ) {
    return null;
  }
  return { organizationId, projectId, issueId: params.issueId };
}

/**
 * POST .../issues/:issueId/state — Issue status transition with optimistic
 * version, auto-assign on start-processing, resolution/ignore payloads, activity
 * and security audit (DAT-14 spec §5/§7).
 */
export async function handleUpdateIssueState(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(UPDATE_STATE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeIssueCommand(request, reply, deps, requestId);
  if (auth === null) return;
  const body = parsed.data.body as {
    status: string;
    version: number;
    resolution?: { reason: string; version?: string; resolvedAtIso?: string };
    ignoredUntilIso?: string;
    idempotencyKey: string;
  };
  const session = request.sessionPayload;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(UPDATE_STATE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_UPDATE_ISSUE_STATE,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await updateIssueState(client, {
          issueId: auth.issueId,
          projectId: auth.projectId,
          status: body.status,
          version: body.version,
          actorAccountId: session?.accountId ?? '',
          ...(body.resolution === undefined
            ? {}
            : {
                resolution:
                  body.resolution.reason === 'by_time'
                    ? { reason: 'by_time', resolvedAtIso: body.resolution.resolvedAtIso ?? '' }
                    : { reason: 'by_version', version: body.resolution.version ?? '' },
              }),
          ...(body.ignoredUntilIso === undefined ? {} : { ignoredUntilIso: body.ignoredUntilIso }),
        });
        if (result.status === 'conflict')
          throw new ServiceError(409, 'conflict', 'The issue was updated by another member.');
        if (result.status === 'not_found')
          throw new ServiceError(404, 'not_found', 'The issue was not found.');
        if (result.status === 'invalid_input')
          throw new ServiceError(422, 'field_validation', result.code);
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'issue_status_changed',
          details: { projectId: auth.projectId, issueId: auth.issueId, to: body.status },
        });
        return {
          status: 'succeeded',
          issueId: auth.issueId,
          version: body.version + 1,
          activity: {
            type: 'status_changed',
            createdAt: deps.now().toISOString(),
            actorAccountId: session?.accountId,
          },
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(UPDATE_STATE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../issues/:issueId/assignee — assign/transfer/clear. */
export async function handleUpdateIssueAssignee(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(UPDATE_ASSIGNEE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeIssueCommand(request, reply, deps, requestId);
  if (auth === null) return;
  const body = parsed.data.body as {
    assigneeAccountId?: string;
    version: number;
    idempotencyKey: string;
  };
  const session = request.sessionPayload;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(UPDATE_ASSIGNEE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_UPDATE_ISSUE_ASSIGNEE,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await updateIssueAssignee(client, {
          issueId: auth.issueId,
          projectId: auth.projectId,
          assigneeAccountId: body.assigneeAccountId ?? null,
          version: body.version,
          actorAccountId: session?.accountId ?? '',
        });
        if (result.status === 'conflict')
          throw new ServiceError(409, 'conflict', 'The issue was updated by another member.');
        if (result.status === 'not_found')
          throw new ServiceError(404, 'not_found', 'The issue was not found.');
        // PLT-09: append an assign-to-me notification when a real new assignee
        // is set (append-only inside the idempotent transaction; replay is
        // served from the cached result and never re-writes). The recipient is
        // the new assignee; the target is the constrained issue-detail route.
        if (
          result.status === 'succeeded' &&
          body.assigneeAccountId !== undefined &&
          body.assigneeAccountId !== '' &&
          body.assigneeAccountId !== (result.previousAssigneeAccountId ?? undefined)
        ) {
          await persistNotification(client, {
            accountId: body.assigneeAccountId,
            type: 'issue_assigned_to_me',
            businessKey: `assignment:${auth.issueId}:${body.assigneeAccountId}`,
            organizationId: auth.organizationId,
            projectId: auth.projectId,
            title: '分配给我',
            target: {
              routeId: 'project.issue-detail',
              pathParams: {
                organizationId: auth.organizationId,
                projectId: auth.projectId,
                issueId: auth.issueId,
              },
              query: {},
            },
          });
        }
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'issue_assignee_changed',
          details: {
            projectId: auth.projectId,
            issueId: auth.issueId,
            to: body.assigneeAccountId ?? null,
          },
        });
        return {
          status: 'succeeded',
          issueId: auth.issueId,
          version: body.version + 1,
          activity: {
            type: 'assignee_changed',
            createdAt: deps.now().toISOString(),
            actorAccountId: session?.accountId,
          },
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(UPDATE_ASSIGNEE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../issues/:issueId/priority — set/clear priority. */
export async function handleUpdateIssuePriority(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(UPDATE_PRIORITY_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeIssueCommand(request, reply, deps, requestId);
  if (auth === null) return;
  const body = parsed.data.body as { priority?: string; version: number; idempotencyKey: string };
  const session = request.sessionPayload;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(UPDATE_PRIORITY_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_UPDATE_ISSUE_PRIORITY,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await updateIssuePriority(client, {
          issueId: auth.issueId,
          projectId: auth.projectId,
          priority: body.priority ?? null,
          version: body.version,
          actorAccountId: session?.accountId ?? '',
        });
        if (result.status === 'conflict')
          throw new ServiceError(409, 'conflict', 'The issue was updated by another member.');
        if (result.status === 'not_found')
          throw new ServiceError(404, 'not_found', 'The issue was not found.');
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'issue_priority_changed',
          details: { projectId: auth.projectId, issueId: auth.issueId, to: body.priority ?? null },
        });
        return {
          status: 'succeeded',
          issueId: auth.issueId,
          version: body.version + 1,
          activity: {
            type: 'priority_changed',
            createdAt: deps.now().toISOString(),
            actorAccountId: session?.accountId,
          },
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(UPDATE_PRIORITY_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../issues/:issueId/notes — add a member note. */
export async function handleCreateIssueNote(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CREATE_NOTE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeIssueCommand(request, reply, deps, requestId);
  if (auth === null) return;
  const body = parsed.data.body as { content: string; idempotencyKey: string };
  const session = request.sessionPayload;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(CREATE_NOTE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_CREATE_ISSUE_NOTE,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await createIssueNote(client, {
          issueId: auth.issueId,
          projectId: auth.projectId,
          authorAccountId: session?.accountId ?? '',
          content: body.content,
        });
        if (result.status === 'not_found')
          throw new ServiceError(404, 'not_found', 'The issue was not found.');
        if (result.status === 'invalid_input')
          throw new ServiceError(422, 'field_validation', result.code);
        return {
          status: 'succeeded',
          issueId: auth.issueId,
          noteId: result.status === 'succeeded' ? (result.noteId ?? '') : '',
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(CREATE_NOTE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../issues/:issueId/notes/:noteId/delete — soft-delete a note. */
export async function handleDeleteIssueNote(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(DELETE_NOTE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeIssueCommand(request, reply, deps, requestId);
  if (auth === null) return;
  const params = request.params as IssuePathParams;
  if (!requireNumericId(params.noteId, reply, requestId)) return;
  const body = parsed.data.body as { idempotencyKey: string };
  const session = request.sessionPayload;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(DELETE_NOTE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_DELETE_ISSUE_NOTE,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        // Admin-sensitive deletion: org manager OR project_admin (DAT-14 spec §4).
        const role = await getProjectAccessRole(client, {
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          accountId: session?.accountId ?? '',
        });
        const canDeleteSensitive = role.outcome === 'allowed' && role.role === 'project_admin';
        const result = await deleteIssueNote(client, {
          issueId: auth.issueId,
          projectId: auth.projectId,
          noteId: params.noteId ?? '',
          actorAccountId: session?.accountId ?? '',
          canDeleteSensitive,
        });
        if (result.status === 'forbidden')
          throw new ServiceError(403, 'authorization', 'You cannot delete this note.');
        if (result.status === 'not_found')
          throw new ServiceError(404, 'not_found', 'The note was not found.');
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'issue_note_deleted',
          details: { projectId: auth.projectId, issueId: auth.issueId, noteId: params.noteId },
        });
        return { status: 'succeeded', issueId: auth.issueId, noteId: params.noteId ?? '' };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(DELETE_NOTE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../issues/:issueId/merge — merge into a primary Issue. */
export async function handleMergeIssues(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(MERGE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeIssueCommand(request, reply, deps, requestId);
  if (auth === null) return;
  const body = parsed.data.body as {
    primaryIssueId: string;
    version: number;
    idempotencyKey: string;
  };
  if (!requireNumericId(body.primaryIssueId, reply, requestId)) return;
  const session = request.sessionPayload;
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(MERGE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_MERGE_ISSUES,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        const result = await mergeIssues(client, {
          issueId: auth.issueId,
          primaryIssueId: body.primaryIssueId,
          projectId: auth.projectId,
          version: body.version,
          actorAccountId: session?.accountId ?? '',
        });
        if (result.status === 'conflict')
          throw new ServiceError(409, 'conflict', 'The issue was updated by another member.');
        if (result.status === 'not_found')
          throw new ServiceError(404, 'not_found', 'The issue was not found.');
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'issue_merged',
          details: { projectId: auth.projectId, issueId: auth.issueId, into: body.primaryIssueId },
        });
        return {
          status: 'succeeded',
          issueId: body.primaryIssueId,
          mergedIntoIssueId: body.primaryIssueId,
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(MERGE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../issues/batch — page-scoped batch update (≤100 items). */
export async function handleBatchUpdateIssues(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(BATCH_OP, { params: request.params, body: request.body });
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
  const params = request.params as { organizationId?: string; projectId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const projectId = params.projectId ?? '';
  const session = await requireSession(request, reply, requestId);
  if (session === null) return;
  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (
    permissions.orgRole === null ||
    !(await requireProjectAccess(
      permissions,
      session.accountId,
      organizationId,
      projectId,
      deps,
      reply,
      requestId,
    )) ||
    !(await requireProjectHandleAccess(
      session.accountId,
      organizationId,
      projectId,
      deps,
      reply,
      requestId,
    ))
  ) {
    return;
  }
  const body = parsed.data.body as {
    items: readonly { issueId: string; action: string; target?: string; version: number }[];
    idempotencyKey: string;
  };
  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(BATCH_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_BATCH_UPDATE_ISSUES,
      digest,
      execute: async (client) => {
        await requireProjectHandleAccessOnTransaction(
          client,
          session.accountId,
          organizationId,
          projectId,
        );
        const result = await batchUpdateIssues(client, {
          projectId,
          actorAccountId: session.accountId,
          items: body.items.map((item) => ({
            issueId: item.issueId,
            action: item.action as 'status' | 'assignee' | 'priority',
            target: item.target ?? null,
            version: item.version,
          })),
        });
        if (result.status === 'invalid_input')
          throw new ServiceError(422, 'field_validation', result.code);
        await insertAuditEvent(client, {
          organizationId,
          actorAccountId: session.accountId,
          action: 'issue_batch_updated',
          details: { projectId, itemCount: body.items.length },
        });
        return { status: 'succeeded', ...result.result };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(BATCH_OP, reply, requestId, idempotency.resultData);
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
