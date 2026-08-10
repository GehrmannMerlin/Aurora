import type { FastifyReply, FastifyRequest } from 'fastify';
import { OPERATION_ID_GET_ISSUE_DETAIL, OPERATION_ID_LIST_ISSUES } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  queryIssueActivity,
  queryIssueDetail,
  queryIssueListPage,
  queryIssueSamples,
} from '@aurora/processing-store';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import {
  projectNavigation,
  requireProjectAccess,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_ISSUES_OPERATION: OperationDef = operationById(OPERATION_ID_LIST_ISSUES);
const GET_ISSUE_DETAIL_OPERATION: OperationDef = operationById(OPERATION_ID_GET_ISSUE_DETAIL);

/** Query windows are capped at 90 days (DAT-16 precedent). */
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** `end` may be up to ~5 minutes ahead of the server clock. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Page/route dimensions have no protocol data (contract gap) — always unavailable. */
const ENV_RELEASE_REASON = 'environment/release dimensions have no protocol data (contract gap)';

/** Normalize Fastify's bracket-notation query keys back into nested objects. */
function normalizeBracketQuery(query: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    const match = /^([^[\]]+)\[([^\]]+)\]$/.exec(key);
    const parent = match?.[1];
    const child = match?.[2];
    if (parent !== undefined && child !== undefined) {
      const existing = result[parent];
      if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
        (existing as Record<string, unknown>)[child] = value;
      } else {
        result[parent] = { [child]: value };
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function numericId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,19}$/.test(value);
}

/** Flatten a safe nested object to a flat string-keyed map (string leaves only). */
function flattenSafeRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (node: unknown, prefix: string): void => {
    if (typeof node === 'string') {
      out[prefix] = node;
      return;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      visit(child, prefix === '' ? key : `${prefix}.${key}`);
    }
  };
  visit(value, '');
  return out;
}

/**
 * GET /api/platform/v1/organizations/:organizationId/projects/:projectId/issues
 * — DAT-15 C3 issue list. Session + project-access gating; read-only; honest
 * `empty`/`unavailable` section semantics (no data is ever invented).
 */
export async function handleListIssues(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const rawQuery = normalizeBracketQuery(request.query as Record<string, unknown>);
  const rawLimit = rawQuery.limit;
  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : rawLimit;
  if (typeof limit === 'number' && !Number.isInteger(limit)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const query = { ...rawQuery, limit };
  const parsed = parseInput(LIST_ISSUES_OPERATION, { params: request.params, query });
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
  const input = parsed.data.query as {
    timeRange: { start: string; end: string };
    status?: string;
    assigneeAccountId?: string;
    priority?: string;
    cursor?: string;
    limit?: number;
  };
  const startMs = new Date(input.timeRange.start).getTime();
  const endMs = new Date(input.timeRange.end).getTime();
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    startMs >= endMs ||
    endMs - startMs > MAX_WINDOW_MS ||
    endMs > deps.now().getTime() + CLOCK_SKEW_MS
  ) {
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
  if (permissions.orgRole === null) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to access this organization.',
    );
    return;
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
    ))
  ) {
    return;
  }

  let page;
  try {
    page = await queryIssueListPage(deps.pool, {
      projectId,
      startIso: input.timeRange.start,
      endIso: input.timeRange.end,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.assigneeAccountId === undefined
        ? {}
        : { assigneeAccountId: input.assigneeAccountId }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit ?? 50,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  // The `issueListData` contract requires `items` + `pagination` in every
  // section variant, so an empty window must still return a well-formed shape
  // (empty items + an honest 0 totalCount) rather than a schema-invalid body
  // that `serializeOutput` rejects as a 500.
  const issuesSection =
    page.items.length === 0
      ? {
          status: 'empty' as const,
          reason: 'no issues in window',
          items: [],
          pagination: {
            totalCount: 0,
            totalCountStatus: 'available' as const,
          },
        }
      : {
          status: 'available' as const,
          items: page.items.map((item) => ({
            ...item,
            occurrenceCount: Number(item.occurrenceCount),
          })),
          pagination: {
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
            totalCount: Number(page.totalCount),
            totalCountStatus: 'available' as const,
          },
        };

  const body = {
    data: {
      issues: issuesSection,
      filters: { status: 'available' as const },
      summary: { status: 'available' as const },
      environments: { status: 'unavailable' as const, reason: ENV_RELEASE_REASON },
      releases: { status: 'unavailable' as const, reason: ENV_RELEASE_REASON },
    },
    meta: {
      requestId,
      readAt: deps.now().toISOString(),
      normalizedQuery: { timeRange: `${input.timeRange.start}..${input.timeRange.end}` },
    },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.issues', organizationId, projectId),
  };

  const serialized = serializeOutput(LIST_ISSUES_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId
 * — DAT-15 C4 issue detail: aggregate + bounded safe samples + activity/notes.
 */
export async function handleGetIssueDetail(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_ISSUE_DETAIL_OPERATION, { params: request.params });
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
  const params = request.params as {
    organizationId?: string;
    projectId?: string;
    issueId?: string;
  };
  if (
    !requireUuidParams(
      { organizationId: params.organizationId, projectId: params.projectId },
      reply,
      requestId,
    )
  )
    return;
  if (!numericId(params.issueId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const organizationId = params.organizationId ?? '';
  const projectId = params.projectId ?? '';
  const issueId = params.issueId;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;
  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
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
    return;
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
    ))
  ) {
    return;
  }

  let detail;
  try {
    detail = await queryIssueDetail(deps.pool, projectId, issueId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (detail === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The issue was not found.');
    return;
  }

  let samples;
  let activity;
  try {
    [samples, activity] = await Promise.all([
      queryIssueSamples(deps.pool, projectId, issueId),
      queryIssueActivity(deps.pool, projectId, issueId),
    ]);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data: {
      issue: {
        status: 'available' as const,
        data: { ...detail, occurrenceCount: Number(detail.occurrenceCount) },
      },
      samples:
        samples.length === 0
          ? { status: 'empty' as const, reason: 'no representative samples retained' }
          : {
              status: 'available' as const,
              items: samples.map((sample) => ({
                ...sample,
                sampleBody: flattenSafeRecord(sample.sampleBody),
              })),
            },
      activity:
        activity.activities.length === 0 && activity.notes.length === 0
          ? { status: 'empty' as const, reason: 'no activity yet' }
          : {
              status: 'available' as const,
              activities: activity.activities.map((entry) => ({
                ...entry,
                details: flattenSafeRecord(entry.details),
              })),
              notes: activity.notes,
            },
    },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.issue-detail', organizationId, projectId),
  };

  const serialized = serializeOutput(GET_ISSUE_DETAIL_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
