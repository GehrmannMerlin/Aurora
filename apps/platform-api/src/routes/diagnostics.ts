import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  queryProjectInboxDiagnostics,
  type ProjectInboxDiagnostics,
} from '@aurora/ingestion-inbox';
import {
  queryProjectCredentialSafeStatus,
  type ProjectCredentialSafeStatus,
} from '@aurora/ingestion-credentials';
import {
  queryProjectQueryableEvidence,
  type ProjectQueryableEvidence,
} from '@aurora/processing-store';
import { OPERATION_ID_GET_DATA_STATUS } from '@aurora/platform-contract';
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
  type OrgNavigationTarget,
} from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const GET_DATA_STATUS_OPERATION: OperationDef = operationById(OPERATION_ID_GET_DATA_STATUS);

/** Default query window is the last 24 hours (spec §5.2). */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Query windows are capped at 7 days (spec §5.2). */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** `end` may be up to ~5 minutes ahead of the server clock to allow clock skew. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const STAGES_EMPTY_REASON = 'no inbox rows in window';
const CREDENTIAL_EMPTY_REASON = 'no client reporting credentials';
const REJECTION_UNAVAILABLE_REASON = 'rejected batches are not persisted (deferred)';
const ENVIRONMENT_UNAVAILABLE_REASON = 'environment not persisted (deferred)';

export type DiagnosisSummaryStatus =
  'receiving' | 'processing' | 'blocked' | 'not_receiving' | 'unknown';
export type DiagnosisPrimaryCause =
  'credential_inactive' | 'no_credential' | 'no_received_events' | 'processing_backlog';

/** Pure inputs needed to derive the DiagnosisSummary (spec §5.3). */
export interface DiagnosisSummaryInput {
  readonly activeCount: number;
  readonly disabledCount: number;
  readonly revokedCount: number;
  readonly receivedCount: number;
  readonly processingCount: number;
  readonly processedCount: number;
}

export interface DerivedDiagnosisSummary {
  readonly status: DiagnosisSummaryStatus;
  readonly primaryCause?: DiagnosisPrimaryCause;
}

/**
 * Derive the DiagnosisSummary.status/primaryCause from the credential safe
 * status and the inbox window facts (spec §5.3 priority order, highest first):
 * (1) credentials exist AND none active → blocked/credential_inactive;
 * (2) no credentials → not_receiving/no_credential;
 * (3) credentials exist but window receivedCount === 0 → not_receiving/
 *     no_received_events;
 * (4) processingCount > 0 → processing/processing_backlog;
 * (5) processedCount > 0 → receiving (no primaryCause);
 * (6) otherwise → unknown. A pure function so the priority rules are unit-tested.
 */
export function deriveDiagnosisSummary(input: DiagnosisSummaryInput): DerivedDiagnosisSummary {
  const credentialExists = input.activeCount + input.disabledCount + input.revokedCount > 0;
  if (credentialExists && input.activeCount === 0) {
    return { status: 'blocked', primaryCause: 'credential_inactive' };
  }
  if (!credentialExists) {
    return { status: 'not_receiving', primaryCause: 'no_credential' };
  }
  if (input.receivedCount === 0) {
    return { status: 'not_receiving', primaryCause: 'no_received_events' };
  }
  if (input.processingCount > 0) {
    return { status: 'processing', primaryCause: 'processing_backlog' };
  }
  if (input.processedCount > 0) {
    return { status: 'receiving' };
  }
  return { status: 'unknown' };
}

/**
 * Closed actionTargets mapping (spec §5.3): blocked/credential_inactive →
 * project.client-keys; not_receiving → project.onboarding; processing/receiving
 * → project.requests + project.performance; unknown → none. The caller has
 * already passed `requireProjectAccess`, so every emitted target is authorized.
 */
export function deriveActionTargets(
  summary: DerivedDiagnosisSummary,
  organizationId: string,
  projectId: string,
): readonly OrgNavigationTarget[] {
  if (summary.status === 'blocked') {
    return [
      { routeId: 'project.client-keys', pathParams: { organizationId, projectId }, query: {} },
    ];
  }
  if (summary.status === 'not_receiving') {
    return [
      { routeId: 'project.onboarding', pathParams: { organizationId, projectId }, query: {} },
    ];
  }
  if (summary.status === 'processing' || summary.status === 'receiving') {
    return [
      { routeId: 'project.requests', pathParams: { organizationId, projectId }, query: {} },
      { routeId: 'project.performance', pathParams: { organizationId, projectId }, query: {} },
    ];
  }
  return [];
}

interface DataStatusTimeRange {
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
 * GET /api/platform/v1/organizations/:organizationId/projects/:projectId/data-status
 * — DAT-20 C7 project-scoped ingestion diagnosis status query (project.data-status
 * Route Target). Session + org membership + project-access gating; owner/admin
 * may view any org project, a plain org member only projects where they hold a
 * `project_members` row, and an unauthorized caller receives a closed 403 with
 * no data (the three read repositories are never called for them). A project
 * that does not exist in the org is a closed 404. The response is a
 * `queryResponse` with honest `empty`/`unavailable` section semantics: rejected
 * batches are never persisted (always unavailable), environment evidence is
 * deferred (always unavailable), and missing data is never invented as zero.
 */
export async function handleGetDataStatus(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  // A single server snapshot timestamp drives the default window, the window
  // clock-skew check and both `asOf`/`readAt` (spec §5.3).
  const now = deps.now();
  const nowMs = now.getTime();

  const rawQuery = normalizeBracketQuery(request.query as Record<string, unknown>);
  const parsed = parseInput(GET_DATA_STATUS_OPERATION, {
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

  const input = parsed.data.query as { timeRange?: DataStatusTimeRange };
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

  let inbox: ProjectInboxDiagnostics;
  let credential: ProjectCredentialSafeStatus;
  let queryable: ProjectQueryableEvidence;
  try {
    [inbox, credential, queryable] = await Promise.all([
      queryProjectInboxDiagnostics(deps.pool, { projectId, startIso: start, endIso: end }),
      queryProjectCredentialSafeStatus(deps.pool, { projectId }),
      queryProjectQueryableEvidence(deps.pool, { projectId }),
    ]);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const receivedCount =
    inbox.byState.pending +
    inbox.byState.leased +
    inbox.byState.retry_waiting +
    inbox.byState.processed +
    inbox.byState.dead_lettered;
  const processingCount =
    inbox.byState.pending + inbox.byState.leased + inbox.byState.retry_waiting;
  const processedCount = inbox.byState.processed;
  const deadLetterCount = inbox.byState.dead_lettered;

  const asOf = now.toISOString();
  const summary = deriveDiagnosisSummary({
    activeCount: credential.activeCount,
    disabledCount: credential.disabledCount,
    revokedCount: credential.revokedCount,
    receivedCount,
    processingCount,
    processedCount,
  });
  const actionTargets = deriveActionTargets(summary, organizationId, projectId);

  const summarySection = {
    status: 'available' as const,
    data: {
      status: summary.status,
      ...(summary.primaryCause === undefined ? {} : { primaryCause: summary.primaryCause }),
      asOf,
    },
  };

  const stages =
    receivedCount === 0
      ? { status: 'empty' as const, reason: STAGES_EMPTY_REASON }
      : {
          status: 'available' as const,
          data: {
            received: {
              count: receivedCount,
              ...(inbox.latestReceivedAt === null ? {} : { latestAt: inbox.latestReceivedAt }),
            },
            processing: { count: processingCount },
            processed: {
              count: processedCount,
              ...(inbox.latestProcessedAt === null ? {} : { latestAt: inbox.latestProcessedAt }),
            },
            deadLetter: {
              count: deadLetterCount,
              ...(inbox.latestDeadLetteredAt === null
                ? {}
                : { latestAt: inbox.latestDeadLetteredAt }),
              ...(inbox.lastErrorCode === null ? {} : { lastErrorCode: inbox.lastErrorCode }),
            },
          },
        };

  const recent =
    receivedCount === 0
      ? { status: 'empty' as const, reason: STAGES_EMPTY_REASON }
      : {
          status: 'available' as const,
          data: {
            ...(inbox.latestReceivedAt === null
              ? {}
              : { latestReceivedAt: inbox.latestReceivedAt }),
            receivedCount,
            ...(inbox.latestProcessedAt === null
              ? {}
              : { latestProcessedAt: inbox.latestProcessedAt }),
            processedCount,
            environmentBreakdown: {
              status: 'unavailable' as const,
              reason: ENVIRONMENT_UNAVAILABLE_REASON,
            },
          },
        };

  const rejection = {
    status: 'unavailable' as const,
    reason: REJECTION_UNAVAILABLE_REASON,
  };

  const credentialSection =
    credential.activeCount + credential.disabledCount + credential.revokedCount === 0
      ? { status: 'empty' as const, reason: CREDENTIAL_EMPTY_REASON }
      : {
          status: 'available' as const,
          data: {
            activeCount: credential.activeCount,
            disabledCount: credential.disabledCount,
            revokedCount: credential.revokedCount,
            ...(credential.latestCreatedAt === null
              ? {}
              : { latestCreatedAt: credential.latestCreatedAt }),
          },
        };

  // Queryable evidence counts are real row counts (factual zeros when the store
  // holds nothing for the project) — never forged as absent.
  const queryableSection = {
    status: 'available' as const,
    data: {
      errorOccurrences: queryable.errorOccurrences,
      requestMetricBuckets: queryable.requestMetricBuckets,
      performanceMetricBuckets: queryable.performanceMetricBuckets,
      ...(inbox.latestProcessedAt === null ? {} : { latestProcessedAt: inbox.latestProcessedAt }),
    },
  };

  const body = {
    data: {
      summary: summarySection,
      stages,
      recent,
      rejection,
      credential: credentialSection,
      queryable: queryableSection,
      actionTargets,
    },
    meta: {
      requestId,
      readAt: asOf,
      normalizedQuery: { timeRange: `${start}..${end}` },
    },
    allowedActions: toContractAllowedActions(permissions),
    navigationTargets: projectNavigation('project.data-status', organizationId, projectId),
  };

  const serialized = serializeOutput(GET_DATA_STATUS_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
