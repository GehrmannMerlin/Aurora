import type { FastifyReply, FastifyRequest } from 'fastify';
import { queryProjectInboxDiagnostics } from '@aurora/ingestion-inbox';
import { queryProjectQueryableEvidence } from '@aurora/processing-store';
import { listProjects } from '@aurora/platform-project-governance';
import {
  DEFAULT_ORGANIZATION_QUOTA,
  OPERATION_ID_GET_USAGE_SUMMARY,
  degradeForUsageRatio,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import { requireOrgManager, requireSession, requireUuidParams } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const GET_USAGE_SUMMARY_OPERATION: OperationDef = operationById(OPERATION_ID_GET_USAGE_SUMMARY);

/** Periodic usage window: the last 30 days (PRD §15.4, org timezone not yet wired). */
const PERIOD_DAYS = 30;

/**
 * DAT-21 B5 usage / quota / degradation projection.
 *
 * Real processed data only — no sampling extrapolation and no billing (PRD
 * §15.1). `acceptedEvents` sums the org's project inbox diagnostics (received
 * events across all states) and `processedEvents` sums the queryable evidence
 * row counts across the org's projects. The degradation stage is a pure
 * projection of the usage ratio against the default periodic quota (D2/G13 will
 * replace the quota with platform-admin configuration later).
 */
export async function handleGetUsageSummary(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(GET_USAGE_SUMMARY_OPERATION, {
    params: request.params,
    query: {},
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

  const params = request.params as { organizationId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  const permissions = await effectivePermissions(session.accountId, organizationId, deps);
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  let projects;
  try {
    projects = await listProjects(deps.pool, {
      orgId: organizationId,
      accountId: session.accountId,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    return;
  }

  const now = deps.now();
  const endIso = now.toISOString();
  const startIso = new Date(now.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  let acceptedEvents = 0;
  let processedEvents = 0;
  for (const project of projects) {
    try {
      const diagnostics = await queryProjectInboxDiagnostics(deps.pool, {
        projectId: project.projectId,
        startIso,
        endIso,
      });
      const byState = diagnostics.byState;
      acceptedEvents +=
        byState.pending +
        byState.leased +
        byState.retry_waiting +
        byState.processed +
        byState.dead_lettered;
      const evidence = await queryProjectQueryableEvidence(deps.pool, {
        projectId: project.projectId,
      });
      processedEvents +=
        evidence.errorOccurrences +
        evidence.requestMetricBuckets +
        evidence.performanceMetricBuckets;
    } catch (error) {
      if (await sendMappedError(reply, requestId, error)) return;
      return;
    }
  }

  const quota = DEFAULT_ORGANIZATION_QUOTA;
  const ratio = acceptedEvents / quota;
  const stage = degradeForUsageRatio(ratio);

  const body = {
    data: {
      organizationId,
      periodStart: startIso,
      periodEnd: endIso,
      acceptedEvents,
      processedEvents,
      quotaAcceptedEvents: quota,
      ratio,
      stage,
      note: 'usage from real processed data; performance/slow sample counts unavailable',
    },
    meta: { requestId, readAt: now.toISOString() },
    allowedActions: ['read'],
    navigationTargets: [],
  };

  const serialized = serializeOutput(GET_USAGE_SUMMARY_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  await reply.code(200).send(serialized.body);
}
