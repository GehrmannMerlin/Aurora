import type { FastifyReply, FastifyRequest } from 'fastify';
import { queryPerformanceMetricSummary } from '@aurora/processing-store';
import { OPERATION_ID_LIST_PERFORMANCE_PAGES } from '@aurora/platform-contract';
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

const LIST_PERFORMANCE_PAGES_OPERATION: OperationDef = operationById(
  OPERATION_ID_LIST_PERFORMANCE_PAGES,
);

/** Default query window is the last 24 hours (spec §5.2). */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Query windows are capped at 7 days (spec §5.2). */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** `end` may be up to ~5 minutes ahead of the server clock to allow clock skew. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** The page dimension is not present in the performance store (spec §1/§4/§5.3). */
const PAGES_UNAVAILABLE_REASON = 'page dimension not in performance data (deferred)';
/** Percentile raw material is deferred (ADR-021); the section reason is fixed. */
const PERCENTILES_REASON = 'percentiles deferred (ADR-021)';
const EMPTY_METRICS_REASON = 'no performance data in window';

interface PerformanceTimeRange {
  readonly start: string;
  readonly end: string;
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
 * GET /api/platform/v1/organizations/:organizationId/projects/:projectId/performance
 * — DAT-17 C6 project-scoped performance metric query projection (project.performance
 * Route Target). Session + org membership + project-access gating; owner/admin may
 * view any org project, a plain org member only projects where they hold a
 * `project_members` row, and an unauthorized caller receives a closed 403 with no
 * data (the read repository is never called for them). A project that does not
 * exist in the org is a closed 404. The response is a `queryResponse` with honest
 * `empty`/`unavailable` section semantics: the page dimension is not present in
 * the performance store and percentile raw material is deferred (ADR-021), so
 * `pages`/`percentiles` are always unavailable rather than forged. `metrics`
 * surfaces the real (project_id, metric_name, unit) aggregates with the true
 * `dataThrough`/`isPartial` watermark; missing data is never invented as zero.
 */
export async function handleListPerformancePages(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  // A single server snapshot timestamp drives the default window, the window
  // clock-skew check and `readAt` (spec §5.3).
  const now = deps.now();
  const nowMs = now.getTime();

  const rawQuery = normalizeBracketQuery(request.query as Record<string, unknown>);
  const parsed = parseInput(LIST_PERFORMANCE_PAGES_OPERATION, {
    params: request.params,
    query: rawQuery,
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

  const input = parsed.data.query as { timeRange?: PerformanceTimeRange };
  // Optional timeRange (spec §5.2): default is the last 24 hours.
  const { start, end } = input.timeRange ?? {
    start: new Date(nowMs - DEFAULT_WINDOW_MS).toISOString(),
    end: now.toISOString(),
  };

  // Handler-owned window validation (the contract schema validates format only):
  // `start < end`, window ≤ 7 days, and `end` not more than ~5 min ahead of the
  // server clock. A violation is a structural 400.
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    startMs >= endMs ||
    endMs - startMs > MAX_WINDOW_MS ||
    endMs > nowMs + CLOCK_SKEW_MS
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

  let summary;
  try {
    summary = await queryPerformanceMetricSummary(deps.pool, {
      projectId,
      startIso: start,
      endIso: end,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const dataThrough = summary.dataThrough;
  const metricsSection =
    summary.metrics.length === 0
      ? { status: 'empty' as const, reason: EMPTY_METRICS_REASON }
      : {
          status: 'available' as const,
          data: {
            metrics: summary.metrics,
            ...(dataThrough === null ? {} : { dataThrough }),
            isPartial: dataThrough !== null && new Date(dataThrough).getTime() < endMs,
          },
        };

  const body = {
    data: {
      metrics: metricsSection,
      pages: { status: 'unavailable' as const, reason: PAGES_UNAVAILABLE_REASON },
      percentiles: { status: 'unavailable' as const, reason: PERCENTILES_REASON },
    },
    meta: {
      requestId,
      readAt: now.toISOString(),
      normalizedQuery: { timeRange: `${start}..${end}` },
    },
    allowedActions: toContractAllowedActions(permissions),
    navigationTargets: projectNavigation('project.performance', organizationId, projectId),
  };

  const serialized = serializeOutput(LIST_PERFORMANCE_PAGES_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
