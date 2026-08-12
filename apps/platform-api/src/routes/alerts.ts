import type { FastifyReply, FastifyRequest } from 'fastify';
import { insertAuditEvent } from '@aurora/platform-identity';
import { findMembership, listMembers } from '@aurora/platform-organization';
import {
  ALERT_CAPABILITY_METRICS,
  ALERT_COOLDOWN_MINUTES,
  ALERT_FILTER_DIMENSIONS,
  ALERT_TRIGGER_DURATIONS_MINUTES,
  ALERT_WINDOWS_MINUTES,
  OPERATION_ID_ALERTS_CREATE_RULE,
  OPERATION_ID_ALERTS_GET_CAPABILITY,
  OPERATION_ID_ALERTS_GET_INSTANCE,
  OPERATION_ID_ALERTS_LIST,
  OPERATION_ID_ALERTS_UPDATE_RULE,
  type AlertMetric,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  createAlertRule,
  listAlertRules,
  queryAlertInstanceDetail,
  queryAlertInstances,
  updateAlertRule,
  type AlertRuleRow,
} from '@aurora/processing-store';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import { maskEmail } from '../email-mask.js';
import {
  projectNavigation,
  requireProjectAccess,
  requireProjectAlertManageAccess,
  requireProjectAlertManageOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const GET_CAPABILITY_OP = operationById(OPERATION_ID_ALERTS_GET_CAPABILITY);
const LIST_OP = operationById(OPERATION_ID_ALERTS_LIST);
const CREATE_OP = operationById(OPERATION_ID_ALERTS_CREATE_RULE);
const UPDATE_OP = operationById(OPERATION_ID_ALERTS_UPDATE_RULE);
const GET_INSTANCE_OP = operationById(OPERATION_ID_ALERTS_GET_INSTANCE);

/** Alert rule ids are bigint rendered as text; reject non-numeric before PostgreSQL. */
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

/** Conditionally include the actor field (exactOptionalPropertyTypes-safe). */
function actorField(
  accountId: string | undefined,
): { actorAccountId: string } | Record<string, never> {
  return accountId === undefined ? {} : { actorAccountId: accountId };
}

/** Optional schema fields reject `null`; map DB nulls to undefined. */
function undef<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

interface AlertProjectParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/** Session + org membership + project view access (shared by all alert handlers). */
async function authorizeAlertView(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<AlertProjectParams | null> {
  const params = request.params as AlertProjectParams;
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

/**
 * GET .../alerts/capability — C11 rule form capability: fixed metric/window/
 * duration/cooldown options, filter-dimension availability, and eligible
 * recipient members. Product alerts only (OPS-06 is a separate concern).
 */
export async function handleGetAlertsCapability(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_CAPABILITY_OP, { params: request.params });
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
  const auth = await authorizeAlertView(request, reply, deps, requestId);
  if (auth === null) return;

  let members;
  try {
    members = await listMembers(deps.pool, auth.organizationId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data: {
      metrics: ALERT_CAPABILITY_METRICS.map((m) => ({
        metric: m.metric,
        displayName: m.displayName,
        unit: m.unit,
        direction: m.direction,
        isRatio: m.isRatio,
        minSamplesRequired: m.minSamplesRequired,
        filterDimensions: m.filterDimensions,
      })),
      windowsMinutes: ALERT_WINDOWS_MINUTES,
      triggerDurationsMinutes: ALERT_TRIGGER_DURATIONS_MINUTES,
      cooldownsMinutes: ALERT_COOLDOWN_MINUTES,
      filterDimensions: ALERT_FILTER_DIMENSIONS.map((id) => ({
        id,
        available: false,
        reason: 'no event-side data source for this filter dimension yet',
      })),
      recipients: members.slice(0, 200).map((m) => ({
        accountId: m.accountId,
        maskedEmail: maskEmail(m.email),
      })),
    },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.alerts', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(GET_CAPABILITY_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

function toRuleSummary(rule: AlertRuleRow): Record<string, unknown> {
  return {
    ruleId: rule.id,
    name: undef(rule.name),
    metric: rule.metric,
    windowMinutes: rule.windowMinutes,
    triggerThreshold: rule.triggerThreshold,
    recoveryThreshold: rule.recoveryThreshold,
    recipientAccountIds: rule.recipientAccountIds,
    evaluation: {
      state: rule.evaluationState,
      observedValue: undef(rule.lastObservedValue),
      sinceAt:
        rule.evaluationSince === null ? undefined : rule.evaluationSince.toISOString(),
      lastEvaluatedAt:
        rule.lastEvaluatedAt === null ? undefined : rule.lastEvaluatedAt.toISOString(),
      pauseReason: undef(rule.evaluationPauseReason),
    },
    version: rule.version,
  };
}

/**
 * GET .../alerts — C10 rules tab (with current evaluation projection) and
 * instances tab. Both sections are honest: no rules / no instances are `empty`,
 * never fabricated. Rule current evaluation is server-computed and separate
 * from instance lifecycle state.
 */
export async function handleListRulesAndInstances(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_OP, { params: request.params });
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
  const auth = await authorizeAlertView(request, reply, deps, requestId);
  if (auth === null) return;

  let rules;
  let instances;
  try {
    [rules, instances] = await Promise.all([
      listAlertRules(deps.pool, { projectId: auth.projectId }),
      queryAlertInstances(deps.pool, { projectId: auth.projectId }),
    ]);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data: {
      rules:
        rules.length === 0
          ? { status: 'empty' as const, reason: 'no alert rules' }
          : {
              status: 'available' as const,
              data: { items: rules.map(toRuleSummary) },
            },
      instances:
        instances.length === 0
          ? { status: 'empty' as const, reason: 'no alert instances' }
          : {
              status: 'available' as const,
              data: {
                items: instances.map((i) => ({
                  instanceId: i.instanceId,
                  ruleId: i.ruleId,
                  ruleName: undef(i.ruleName),
                  metric: i.metric,
                  state: i.state,
                  triggeredAt: i.triggeredAt,
                  recoveredAt: undef(i.recoveredAt),
                  pauseReason: undef(i.pauseReason),
                })),
                count: instances.length,
                totalCountStatus: 'bounded' as const,
              },
            },
    },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.alerts', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(LIST_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

interface AlertRuleCommandBody {
  readonly name?: string;
  readonly metric: AlertMetric;
  readonly filters: {
    environment: readonly string[];
    release: readonly string[];
    pageOrEndpoint: readonly string[];
    errorSeverity: readonly string[];
  };
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes?: number;
  readonly minSampleCount?: number;
  readonly cooldownMinutes: number;
  readonly recipientAccountIds: readonly string[];
  readonly idempotencyKey: string;
  readonly version?: number;
}

/**
 * Validate every recipient is a current organization member (PRD §11.4; project
 * effective-access refinement is deferred to the C13 query). Runs on the command
 * transaction so demoted members cannot be stored.
 */
async function validateRecipients(
  client: Parameters<typeof findMembership>[0],
  organizationId: string,
  recipientAccountIds: readonly string[],
): Promise<void> {
  for (const accountId of recipientAccountIds) {
    const membership = await findMembership(client, { orgId: organizationId, accountId });
    if (membership === null) {
      throw new ServiceError(422, 'field_validation', 'recipient is not an organization member');
    }
  }
}

/** POST .../alerts/rules — create an alert rule (project admin, PRD §11.2.8). */
export async function handleCreateAlertRule(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CREATE_OP, { params: request.params, body: request.body });
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
  const auth = await authorizeAlertView(request, reply, deps, requestId);
  if (auth === null) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectAlertManageAccess(
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
  const body = parsed.data.body as AlertRuleCommandBody;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(CREATE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_ALERTS_CREATE_RULE,
      digest,
      execute: async (client) => {
        await requireProjectAlertManageOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        await validateRecipients(client, auth.organizationId, body.recipientAccountIds);
        const result = await createAlertRule(client, {
          projectId: auth.projectId,
          ...(body.name === undefined ? {} : { name: body.name }),
          metric: body.metric,
          filters: body.filters,
          windowMinutes: body.windowMinutes,
          triggerThreshold: body.triggerThreshold,
          triggerDurationMinutes: body.triggerDurationMinutes,
          recoveryThreshold: body.recoveryThreshold,
          ...(body.recoveryDurationMinutes === undefined
            ? {}
            : { recoveryDurationMinutes: body.recoveryDurationMinutes }),
          minSampleCount: body.minSampleCount ?? null,
          cooldownMinutes: body.cooldownMinutes,
          recipientAccountIds: body.recipientAccountIds,
        });
        if (result.status === 'invalid_input') {
          throw new ServiceError(422, 'field_validation', result.code);
        }
        if (result.status !== 'inserted') {
          throw new ServiceError(503, 'authority_unavailable', 'Alert rule store unavailable.');
        }
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'alert.rule_created',
          details: { projectId: auth.projectId, ruleId: result.ruleId, metric: body.metric },
        });
        return { status: 'succeeded', ruleId: result.ruleId };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(CREATE_OP, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/** POST .../alerts/rules/:ruleId — update an alert rule (optimistic version). */
export async function handleUpdateAlertRule(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(UPDATE_OP, { params: request.params, body: request.body });
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
  const params = request.params as AlertProjectParams & { ruleId?: string };
  const auth = await authorizeAlertView(request, reply, deps, requestId);
  if (auth === null) return;
  if (!requireNumericId(params.ruleId, reply, requestId)) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectAlertManageAccess(
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
  const body = parsed.data.body as AlertRuleCommandBody & { version: number };
  const ruleId = params.ruleId as string;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(UPDATE_OP, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_ALERTS_UPDATE_RULE,
      digest,
      execute: async (client) => {
        await requireProjectAlertManageOnTransaction(
          client,
          session?.accountId ?? '',
          auth.organizationId,
          auth.projectId,
        );
        await validateRecipients(client, auth.organizationId, body.recipientAccountIds);
        const result = await updateAlertRule(client, {
          ruleId,
          projectId: auth.projectId,
          ...(body.name === undefined ? {} : { name: body.name }),
          metric: body.metric,
          filters: body.filters,
          windowMinutes: body.windowMinutes,
          triggerThreshold: body.triggerThreshold,
          triggerDurationMinutes: body.triggerDurationMinutes,
          recoveryThreshold: body.recoveryThreshold,
          ...(body.recoveryDurationMinutes === undefined
            ? {}
            : { recoveryDurationMinutes: body.recoveryDurationMinutes }),
          minSampleCount: body.minSampleCount ?? null,
          cooldownMinutes: body.cooldownMinutes,
          recipientAccountIds: body.recipientAccountIds,
          version: body.version,
        });
        if (result.status === 'invalid_input') {
          throw new ServiceError(422, 'field_validation', result.code);
        }
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The alert rule was not found.');
        }
        if (result.status === 'version_conflict') {
          throw new ServiceError(409, 'version_conflict', 'The alert rule was updated by another member.');
        }
        if (result.status !== 'updated') {
          throw new ServiceError(503, 'authority_unavailable', 'Alert rule store unavailable.');
        }
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'alert.rule_updated',
          details: { projectId: auth.projectId, ruleId, metric: body.metric },
        });
        return { status: 'succeeded', ruleId, version: result.version };
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

/**
 * GET .../alerts/instances/:instanceId — C12 instance detail: current state,
 * direct reason, rule snapshot (separate from the current rule), evaluation
 * evidence and the ordered business transition timeline. Read-only.
 */
export async function handleGetAlertInstanceDetail(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_INSTANCE_OP, { params: request.params });
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
  const params = request.params as AlertProjectParams & { instanceId?: string };
  const auth = await authorizeAlertView(request, reply, deps, requestId);
  if (auth === null) return;
  if (!requireNumericId(params.instanceId, reply, requestId)) return;

  let detail;
  try {
    detail = await queryAlertInstanceDetail(deps.pool, {
      projectId: auth.projectId,
      instanceId: params.instanceId as string,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (detail === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The alert instance was not found.');
    return;
  }

  const lastTransition = detail.transitions[detail.transitions.length - 1];
  const directReason =
    detail.instance.state === 'evaluation_paused'
      ? detail.instance.pauseReason ?? 'evaluation_paused'
      : lastTransition?.reason ?? 'triggered';

  const body = {
    data: {
      instance: {
        instanceId: detail.instance.id,
        ruleId: detail.instance.ruleId,
        ruleName: undef(detail.instance.ruleName),
        metric: detail.instance.metric,
        state: detail.instance.state,
        directReason,
        triggeredAt: detail.instance.triggeredAt.toISOString(),
        recoveredAt:
          detail.instance.recoveredAt === null ? undefined : detail.instance.recoveredAt.toISOString(),
        pauseReason: undef(detail.instance.pauseReason),
      },
      ruleSnapshot: detail.instance.ruleSnapshot,
      evidence:
        detail.evidence === null
          ? {
              evaluatedAt: detail.instance.triggeredAt.toISOString(),
              windowStartAt: detail.instance.triggeredAt.toISOString(),
              windowEndAt: detail.instance.triggeredAt.toISOString(),
              observedValue: undefined,
              completeness: 'missing',
              appliedFilters: {
                environment: [],
                release: [],
                pageOrEndpoint: [],
                errorSeverity: [],
              },
            }
          : {
              evaluatedAt: detail.evidence.evaluatedAt.toISOString(),
              windowStartAt: detail.evidence.windowStartAt.toISOString(),
              windowEndAt: detail.evidence.windowEndAt.toISOString(),
              observedValue: undef(detail.evidence.observedValue),
              numerator: undef(detail.evidence.numerator),
              denominator: undef(detail.evidence.denominator),
              sampleCount: undef(detail.evidence.sampleCount),
              minSampleRequirement: undef(detail.evidence.minSampleRequirement),
              watermarkAt:
                detail.evidence.watermarkAt === null
                  ? undefined
                  : detail.evidence.watermarkAt.toISOString(),
              completeness: detail.evidence.completeness,
              pauseReason: undef(detail.evidence.pauseReason),
              appliedFilters: detail.evidence.appliedFilters,
            },
      transitions: detail.transitions.map((t) => ({
        from: t.fromState,
        to: t.toState,
        reason: t.reason,
        occurredAt: t.occurredAt.toISOString(),
      })),
    },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation(
      'project.alert-instance-detail',
      auth.organizationId,
      auth.projectId,
    ),
  };

  const serialized = serializeOutput(GET_INSTANCE_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
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
