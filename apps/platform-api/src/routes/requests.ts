import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  queryRequestEndpointPage,
  queryRequestMetricSummary,
} from '@aurora/processing-store';
import { OPERATION_ID_LIST_REQUEST_ENDPOINTS } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { effectivePermissions, toContractAllowedActions } from '../authorization.js';
import {
  projectNavigation,
  requireProjectAccess,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_REQUEST_ENDPOINTS_OPERATION: OperationDef = operationById(
  OPERATION_ID_LIST_REQUEST_ENDPOINTS,
);

/** Query windows are capped at 90 days (spec §5.2). */
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** `end` may be up to ~5 minutes ahead of the server clock to allow clock skew. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** `percentiles` is deferred (ADR-020); the section reason is fixed. */
const PERCENTILES_REASON = 'percentiles deferred (ADR-020)';
const EMPTY_SUMMARY_REASON = 'no request data in window';
const EMPTY_ENDPOINTS_REASON = 'no request samples in window';

interface RequestListTimeRange {
  readonly start: string;
  readonly end: string;
}

interface RequestListQuery {
  readonly timeRange: RequestListTimeRange;
  readonly cursor?: string;
  readonly limit?: number;
}

/**
 * Fastify's default querystring parser (fast-querystring) produces flat keys,
 * so a nested contract query `timeRange: { start, end }` arrives as
 * `timeRange[start]=…&timeRange[end]=…`. Normalize bracket-notation keys back
 * into the nested object before `parseInput`.
 */
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

/**
 * GET /api/platform/v1/organizations/:organizationId/projects/:projectId/requests
 * — DAT-16 project-scoped request metric query projection (C5 `project.requests`
 * Route Target). Session + org membership + project access gating; owner/admin
 * may view any org project, a plain org member only projects where they hold a
 * `project_members` row, and an unauthorized caller receives a closed 403 with
 * no data (the data repositories are never called for them). A project that
 * does not exist in the org is a closed 404. The response is a `queryResponse`
 * with honest `empty`/`unavailable` section semantics: no data is ever invented.
 */
export async function handleListRequestEndpoints(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const rawQuery = normalizeBracketQuery(request.query as Record<string, unknown>);
  const rawLimit = rawQuery.limit;
  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : rawLimit;
  // The contract `num(1, 100)` schema accepts non-integers (e.g. 50.5); a page
  // size must be an integer, so reject a present-but-non-integer limit here
  // before `parseInput`. A non-numeric value is already NaN and fails parseInput.
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

  const parsed = parseInput(LIST_REQUEST_ENDPOINTS_OPERATION, {
    params: request.params,
    query,
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

  const params = request.params as { organizationId?: string; projectId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const projectId = params.projectId ?? '';
  const input = parsed.data.query as RequestListQuery;
  const { start, end } = input.timeRange;

  // Handler-owned window validation (the contract schema validates format only):
  // `start < end`, window ≤ 90 days, and `end` not more than ~5 min ahead of the
  // server clock. A violation is a structural 400.
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
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

  const endpointLimit = input.limit ?? 50;
  let summary;
  let endpointPage;
  try {
    [summary, endpointPage] = await Promise.all([
      queryRequestMetricSummary(deps.pool, { projectId, startIso: start, endIso: end }),
      queryRequestEndpointPage(deps.pool, {
        projectId,
        startIso: start,
        endIso: end,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: endpointLimit,
      }),
    ]);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  // Deterministic method order (repository rows are not guaranteed ordered).
  const methods = [...summary.methods].sort((a, b) => a.method.localeCompare(b.method));
  const dataThrough = summary.dataThrough;
  const summarySection =
    methods.length === 0
      ? { status: 'empty' as const, reason: EMPTY_SUMMARY_REASON }
      : {
          status: 'available' as const,
          data: {
            methods,
            ...(dataThrough === null ? {} : { dataThrough }),
            isPartial: dataThrough !== null && new Date(dataThrough).getTime() < endMs,
          },
        };

  const endpointsSection =
    endpointPage.items.length === 0
      ? { status: 'empty' as const, reason: EMPTY_ENDPOINTS_REASON }
      : {
          status: 'available' as const,
          data: {
            items: endpointPage.items,
            pagination: {
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
              ...(endpointPage.nextCursor === null ? {} : { nextCursor: endpointPage.nextCursor }),
              totalCount: endpointPage.totalCount,
              totalCountStatus: 'available' as const,
            },
          },
        };

  const body = {
    data: {
      summary: summarySection,
      endpoints: endpointsSection,
      percentiles: { status: 'unavailable' as const, reason: PERCENTILES_REASON },
    },
    meta: {
      requestId,
      readAt: deps.now().toISOString(),
      normalizedQuery: { timeRange: `${start}..${end}` },
    },
    allowedActions: toContractAllowedActions(permissions),
    navigationTargets: projectNavigation('project.requests', organizationId, projectId),
  };

  const serialized = serializeOutput(LIST_REQUEST_ENDPOINTS_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
