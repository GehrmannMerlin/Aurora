import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import {
  bootstrapPlatformDefaultIfAbsent,
  clearProjectLimit,
  computeEffectivePolicy,
  getOrganizationOverride,
  getPlatformDefaultPolicy,
  getProjectLimit,
  PlatformPolicyError,
  resetOrganizationOverride,
  searchPolicyTargets,
  setOrganizationOverride,
  setPlatformDefaultPolicy,
  setProjectLimit,
  type PlatformDefaultPolicy,
  type PlatformPolicyFields,
} from '@aurora/platform-policy';
import { insertPlatformAuditEvent } from '@aurora/platform-admin';
import {
  OPERATION_ID_POLICY_CLEAR_PROJECT_LIMIT,
  OPERATION_ID_POLICY_GET_DEFAULT,
  OPERATION_ID_POLICY_GET_ORGANIZATION,
  OPERATION_ID_POLICY_GET_PROJECT,
  OPERATION_ID_POLICY_RESET_ORGANIZATION,
  OPERATION_ID_POLICY_SET_DEFAULT,
  OPERATION_ID_POLICY_SET_ORGANIZATION,
  OPERATION_ID_POLICY_SET_PROJECT_LIMIT,
  OPERATION_ID_POLICY_TARGET_SEARCH,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import { requirePlatformAdmin, UUID_PATTERN } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const TARGET_SEARCH_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_TARGET_SEARCH);
const GET_DEFAULT_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_GET_DEFAULT);
const GET_ORG_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_GET_ORGANIZATION);
const GET_PROJECT_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_GET_PROJECT);
const SET_DEFAULT_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_SET_DEFAULT);
const SET_ORG_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_SET_ORGANIZATION);
const RESET_ORG_OPERATION: OperationDef = operationById(OPERATION_ID_POLICY_RESET_ORGANIZATION);
const SET_PROJECT_LIMIT_OPERATION: OperationDef = operationById(
  OPERATION_ID_POLICY_SET_PROJECT_LIMIT,
);
const CLEAR_PROJECT_LIMIT_OPERATION: OperationDef = operationById(
  OPERATION_ID_POLICY_CLEAR_PROJECT_LIMIT,
);

/**
 * First version has no data-plane consumer, so propagation is always `unknown`
 * (the page must never claim the policy has already taken effect — plan global
 * constraint; contract `propagation`).
 */
const PROPAGATION = { status: 'unknown' as const, reason: 'no data-plane consumer yet' };

interface PolicyFieldsBody {
  readonly defaultPeriodQuota: number;
  readonly warningRatio: number;
  readonly hardLimit: number;
  readonly degradationEnabled: boolean;
  readonly highValueRetentionDays: number;
}

interface SetDefaultBody extends PolicyFieldsBody {
  readonly version: number;
  readonly idempotencyKey: string;
}

interface SetOrgBody extends PolicyFieldsBody {
  readonly version: number;
  readonly idempotencyKey: string;
}

interface ResetOrgBody {
  readonly version: number;
  readonly confirm: boolean;
  readonly idempotencyKey: string;
}

interface SetProjectLimitBody {
  readonly resourceLimit: number;
  readonly version: number;
  readonly idempotencyKey: string;
}

interface ClearProjectLimitBody {
  readonly version: number;
  readonly confirm: boolean;
  readonly idempotencyKey: string;
}

/** The five PRD §15.8 protective fields as a contract projection. */
function policyFields(p: PlatformPolicyFields): Record<string, unknown> {
  return {
    defaultPeriodQuota: p.defaultPeriodQuota,
    warningRatio: p.warningRatio,
    hardLimit: p.hardLimit,
    degradationEnabled: p.degradationEnabled,
    highValueRetentionDays: p.highValueRetentionDays,
  };
}

/**
 * Map a platform-policy data-layer failure to a ServiceError. `invalid_input`
 * (ratio order / resource limit CHECK) is a closed 422 field_validation; a
 * ServiceError is rethrown as-is so the command transaction rolls back with its
 * explicit status; anything else fails closed 503 (details never leaked).
 */
function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') {
    return new ServiceError(422, 'field_validation', 'The policy configuration is invalid.', {
      fieldErrors: [{ field: 'policy', reason: error.message }],
    });
  }
  return new ServiceError(503, 'authority_unavailable', 'Authority is temporarily unavailable.');
}

/**
 * Map a GET read-layer failure. `PlatformPolicyError` is not part of the
 * `sendMappedError` stable set, so it is mapped here to a closed 503; other
 * stable errors delegate to `sendMappedError`. Returns true when a problem was
 * already sent.
 */
async function sendPolicyReadError(
  reply: FastifyReply,
  requestId: string,
  error: unknown,
): Promise<boolean> {
  if (error instanceof PlatformPolicyError) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Authority is temporarily unavailable.',
    );
    return true;
  }
  return sendMappedError(reply, requestId, error);
}

/**
 * Write an `audit_read` platform audit event on a dedicated connection (released
 * after). The three effective-policy reads are audited so every admin read of
 * the policy surface is itself traceable (mirrors Plan A's admin-list reads).
 * The target-search GET deliberately does NOT audit (a lightweight search would
 * flood the platform audit timeline).
 */
async function writeAuditRead(
  deps: PlatformApiRouteDependencies,
  actorAccountId: string,
  requestId: string,
  scope: string,
): Promise<void> {
  const client = await deps.pool.connect();
  try {
    await insertPlatformAuditEvent(client, {
      actorAccountId,
      action: 'audit_read',
      target: { scope },
      result: 'succeeded',
      requestId,
    });
  } finally {
    client.release();
  }
}

/** Resolve a project's owning organization (the project effective path has only `:projectId`). */
async function resolveProjectOrganizationId(
  deps: PlatformApiRouteDependencies,
  projectId: string,
): Promise<string | null> {
  const result = await deps.pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM projects WHERE project_id = $1',
    [projectId],
  );
  return result.rows[0]?.organization_id ?? null;
}

/** True when the organization row exists (used on the caller's pool or command transaction). */
async function organizationExists(
  pool: Pool | PoolClient,
  organizationId: string,
): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM organizations WHERE organization_id = $1', [
    organizationId,
  ]);
  return result.rows.length > 0;
}

/** True when the project row exists (used on the caller's pool or command transaction). */
async function projectExists(pool: Pool | PoolClient, projectId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM projects WHERE project_id = $1', [projectId]);
  return result.rows.length > 0;
}

/**
 * GET /api/platform/v1/platform-admin/policy/targets — D2 target picker search
 * (admin only). Prefix-matches organizations and projects by name; results are
 * bounded server-side and only `kind='organization'` orgs and
 * `active`/`archived` projects are returned. Writes no audit event (lightweight
 * search would flood the platform audit timeline).
 */
export async function handlePolicyTargetSearch(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const rawQuery = request.query as Record<string, unknown>;
  const rawLimit = rawQuery.limit;
  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : rawLimit;
  // The contract `num(1, 50)` accepts non-integers (e.g. 5.5); a page limit must
  // be an integer, so reject a present-but-non-integer limit before parseInput.
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
  const query = { ...rawQuery, ...(limit === undefined ? {} : { limit }) };
  const parsed = parseInput(TARGET_SEARCH_OPERATION, { params: request.params, query });
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
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;
  const input = parsed.data.query as { q?: string; limit?: number };

  let result;
  try {
    result = await searchPolicyTargets(deps.pool, {
      ...(input.q === undefined ? {} : { query: input.q }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  } catch (error) {
    if (await sendPolicyReadError(reply, requestId, error)) return;
    throw error;
  }

  const itemsCount = result.organizations.length + result.projects.length;
  const body = {
    data: {
      organizations: result.organizations,
      projects: result.projects,
      pagination: { totalCount: itemsCount, totalCountStatus: 'available' as const },
    },
    meta: { requestId, readAt: deps.now().toISOString() },
    allowedActions: ['read'] as const,
    navigationTargets: [],
  };

  const serialized = serializeOutput(TARGET_SEARCH_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/platform-admin/policy/default — platform default resource
 * policy (admin only). Runs the controlled bootstrap first so the default always
 * has a value (idempotent). The read is audited with an `audit_read` event.
 */
export async function handlePolicyGetDefault(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_DEFAULT_OPERATION, {
    params: request.params,
    query: request.query,
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
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;

  let defaultPolicy: PlatformDefaultPolicy | null;
  try {
    await writeAuditRead(deps, session.accountId, requestId, 'platform_resource_policy');
    await bootstrapPlatformDefaultIfAbsent(deps.pool, { actorAccountId: session.accountId });
    defaultPolicy = await getPlatformDefaultPolicy(deps.pool);
  } catch (error) {
    if (await sendPolicyReadError(reply, requestId, error)) return;
    throw error;
  }
  if (defaultPolicy === null) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Authority is temporarily unavailable.',
    );
    return;
  }

  const body = {
    data: {
      data: {
        configured: policyFields(defaultPolicy),
        source: defaultPolicy.policySource,
        effective: policyFields(defaultPolicy),
        version: defaultPolicy.version,
        updatedAt: defaultPolicy.updatedAt,
        ...(defaultPolicy.updatedBy === undefined ? {} : { updatedBy: defaultPolicy.updatedBy }),
        propagation: PROPAGATION,
      },
    },
    meta: { requestId, readAt: deps.now().toISOString() },
    allowedActions: ['read'] as const,
    navigationTargets: [{ routeId: 'platform.resource-policies', pathParams: {}, query: {} }],
  };

  const serialized = serializeOutput(GET_DEFAULT_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/platform-admin/policy/organizations/:organizationId/effective
 * — organization effective resource policy (admin only). Runs the controlled
 * bootstrap first so the platform default always has a value (idempotent),
 * then `configured`/`effective` come from the pure `computeEffectivePolicy`;
 * `source` and `version`/`updated*` are decorated at the handler: an override
 * present → `platform_admin`, none → `inherited_from_platform` (with version
 * 0 = no override row). A phantom organization is a closed 404 before the
 * audit write, so a 404 never creates an `audit_read` event.
 */
export async function handlePolicyGetOrganizationEffective(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_ORG_OPERATION, {
    params: request.params,
    query: request.query,
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
  const organizationId = params.organizationId ?? '';
  if (!UUID_PATTERN.test(organizationId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;

  let defaultPolicy: PlatformDefaultPolicy | null;
  let orgOverride;
  try {
    // A truly nonexistent organization is a closed 404 (not a 200
    // inherited_from_platform projection for a phantom target). The existence
    // check runs BEFORE the audit write so a phantom-org 404 never creates an
    // audit_read event.
    if (!(await organizationExists(deps.pool, organizationId))) {
      await sendProblem(reply, requestId, 404, 'not_found', 'The organization was not found.');
      return;
    }
    await writeAuditRead(deps, session.accountId, requestId, 'organization_resource_policy');
    // Controlled bootstrap first so a fresh environment deep-link to this path
    // is available (idempotent), exactly like policyGetDefault.
    await bootstrapPlatformDefaultIfAbsent(deps.pool, { actorAccountId: session.accountId });
    defaultPolicy = await getPlatformDefaultPolicy(deps.pool);
    orgOverride = await getOrganizationOverride(deps.pool, { organizationId });
  } catch (error) {
    if (await sendPolicyReadError(reply, requestId, error)) return;
    throw error;
  }
  if (defaultPolicy === null) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Authority is temporarily unavailable.',
    );
    return;
  }
  const computed = computeEffectivePolicy({ defaultPolicy, orgOverride, projectLimit: null });
  if (computed === null) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Authority is temporarily unavailable.',
    );
    return;
  }
  const source =
    orgOverride === null ? 'inherited_from_platform' : (orgOverride.policySource as string);

  const body = {
    data: {
      data: {
        configured: policyFields(computed.configured),
        source,
        effective: policyFields(computed.effective),
        version: orgOverride?.version ?? 0,
        ...(orgOverride?.updatedAt === undefined ? {} : { updatedAt: orgOverride.updatedAt }),
        ...(orgOverride?.updatedBy === undefined ? {} : { updatedBy: orgOverride.updatedBy }),
        propagation: PROPAGATION,
      },
    },
    meta: { requestId, readAt: deps.now().toISOString() },
    allowedActions: ['read'] as const,
    navigationTargets: [{ routeId: 'platform.resource-policies', pathParams: {}, query: {} }],
  };

  const serialized = serializeOutput(GET_ORG_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/platform-admin/policy/projects/:projectId/effective —
 * project effective resource policy (admin only). Runs the controlled bootstrap
 * first so the platform default always has a value (idempotent), then
 * `configured` shows only the project's own `resourceLimit`; `effective` carries
 * the five inherited protective fields plus the effective `resourceLimit`.
 * Source decoration: project limit present → `platform_admin`; else org override
 * present → `inherited_from_organization`; else `inherited_from_platform`. A
 * missing project is a closed 404 checked before the audit write.
 */
export async function handlePolicyGetProjectEffective(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GET_PROJECT_OPERATION, {
    params: request.params,
    query: request.query,
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
  const params = request.params as { projectId?: string };
  const projectId = params.projectId ?? '';
  if (!UUID_PATTERN.test(projectId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;

  let organizationId: string | null;
  let defaultPolicy: PlatformDefaultPolicy | null;
  let orgOverride;
  let projectLimit;
  try {
    // Existence check first so a phantom-project 404 never creates an
    // audit_read event (mirrors the org effective path).
    organizationId = await resolveProjectOrganizationId(deps, projectId);
    if (organizationId === null) {
      await sendProblem(reply, requestId, 404, 'not_found', 'Project not found.');
      return;
    }
    await writeAuditRead(deps, session.accountId, requestId, 'project_resource_policy');
    // Controlled bootstrap first so a fresh environment deep-link to this path
    // is available (idempotent), exactly like policyGetDefault.
    await bootstrapPlatformDefaultIfAbsent(deps.pool, { actorAccountId: session.accountId });
    defaultPolicy = await getPlatformDefaultPolicy(deps.pool);
    orgOverride = await getOrganizationOverride(deps.pool, { organizationId });
    projectLimit = await getProjectLimit(deps.pool, { projectId });
  } catch (error) {
    if (await sendPolicyReadError(reply, requestId, error)) return;
    throw error;
  }
  if (defaultPolicy === null) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Authority is temporarily unavailable.',
    );
    return;
  }
  const computed = computeEffectivePolicy({ defaultPolicy, orgOverride, projectLimit });
  if (computed === null) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Authority is temporarily unavailable.',
    );
    return;
  }

  const source =
    projectLimit !== null
      ? 'platform_admin'
      : orgOverride !== null
        ? 'inherited_from_organization'
        : 'inherited_from_platform';
  // A project with no limit row has NO explicit project resource limit (the
  // ADR-035 model has no inherited project resourceLimit to report), so the
  // projection omits `resourceLimit` entirely; the inherited `source` and
  // `version: 0` mark the no-own-config state.
  const resourceLimitFields =
    projectLimit === null ? {} : { resourceLimit: projectLimit.resourceLimit };

  const body = {
    data: {
      data: {
        configured: resourceLimitFields,
        source,
        effective: { ...policyFields(computed.effective), ...resourceLimitFields },
        version: projectLimit?.version ?? 0,
        ...(projectLimit?.updatedAt === undefined ? {} : { updatedAt: projectLimit.updatedAt }),
        ...(projectLimit?.updatedBy === undefined ? {} : { updatedBy: projectLimit.updatedBy }),
        propagation: PROPAGATION,
      },
    },
    meta: { requestId, readAt: deps.now().toISOString() },
    allowedActions: ['read'] as const,
    navigationTargets: [],
  };

  const serialized = serializeOutput(GET_PROJECT_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/platform-admin/policy/default — save the platform
 * default resource policy (admin only, CSRF + idempotent + audited). On a real
 * save (`set`) a `policy_set_default` audit event is written INSIDE the
 * idempotency transaction. `version_conflict` is a closed 409; an invalid
 * ratio is a closed 422; a DB failure fails closed 503.
 */
export async function handlePolicySetDefault(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(SET_DEFAULT_OPERATION, { params: request.params, body: request.body });
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
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;
  const body = parsed.data.body as SetDefaultBody;

  const digest = requestDigest({ operation: OPERATION_ID_POLICY_SET_DEFAULT, ...body });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(SET_DEFAULT_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_POLICY_SET_DEFAULT,
      digest,
      execute: async (client) => {
        try {
          const result = await setPlatformDefaultPolicy(client, {
            defaultPeriodQuota: body.defaultPeriodQuota,
            warningRatio: body.warningRatio,
            hardLimit: body.hardLimit,
            degradationEnabled: body.degradationEnabled,
            highValueRetentionDays: body.highValueRetentionDays,
            expectedVersion: body.version,
            actorAccountId: session.accountId,
          });
          if (result.status === 'version_conflict') {
            throw new ServiceError(
              409,
              'version_conflict',
              'The policy was changed by another administrator.',
            );
          }
          if (result.status === 'temporarily_unavailable') {
            throw new ServiceError(
              503,
              'authority_unavailable',
              'Authority is temporarily unavailable.',
            );
          }
          // The only reachable status here is `set` (version_conflict and
          // temporarily_unavailable throw above), so the audit write is
          // unconditional and atomic with the save.
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'policy_set_default',
            target: { targetType: 'platform' },
            result: 'succeeded',
            requestId,
          });
          return { status: result.status, version: result.version };
        } catch (error) {
          throw toServiceError(error);
        }
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(SET_DEFAULT_OPERATION, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/**
 * POST /api/platform/v1/platform-admin/policy/organizations/:organizationId —
 * save (replace) an organization resource-policy override (admin only, CSRF +
 * idempotent + audited). `version: 0` with no override row inserts version 1;
 * a stale version is a closed 409; a missing organization is a closed 404.
 */
export async function handlePolicySetOrganization(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(SET_ORG_OPERATION, { params: request.params, body: request.body });
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
  const organizationId = params.organizationId ?? '';
  if (!UUID_PATTERN.test(organizationId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;
  const body = parsed.data.body as SetOrgBody;

  // The digest must cover the operation AND the path `organizationId` so two
  // different-target requests reusing the same idempotency key never replay.
  const digest = requestDigest({
    operation: OPERATION_ID_POLICY_SET_ORGANIZATION,
    ...body,
    organizationId,
  });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(SET_ORG_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_POLICY_SET_ORGANIZATION,
      digest,
      execute: async (client) => {
        try {
          const result = await setOrganizationOverride(client, {
            organizationId,
            defaultPeriodQuota: body.defaultPeriodQuota,
            warningRatio: body.warningRatio,
            hardLimit: body.hardLimit,
            degradationEnabled: body.degradationEnabled,
            highValueRetentionDays: body.highValueRetentionDays,
            expectedVersion: body.version,
            actorAccountId: session.accountId,
          });
          if (result.status === 'version_conflict') {
            throw new ServiceError(
              409,
              'version_conflict',
              'The policy was changed by another administrator.',
            );
          }
          if (result.status === 'organization_not_found') {
            throw new ServiceError(404, 'not_found', 'The organization was not found.');
          }
          if (result.status === 'temporarily_unavailable') {
            throw new ServiceError(
              503,
              'authority_unavailable',
              'Authority is temporarily unavailable.',
            );
          }
          // The only reachable status here is `set` (version_conflict,
          // organization_not_found and temporarily_unavailable throw above).
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'policy_set_organization',
            target: { targetType: 'organization', organizationId },
            result: 'succeeded',
            requestId,
          });
          return { status: result.status, version: result.version };
        } catch (error) {
          throw toServiceError(error);
        }
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(SET_ORG_OPERATION, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/**
 * POST /api/platform/v1/platform-admin/policy/organizations/:organizationId/reset
 * — restore an organization override back to the platform default (admin only,
 * confirmed + CSRF + idempotent + audited). A missing `confirm: true` is a
 * closed 422; a stale version is a closed 409.
 */
export async function handlePolicyResetOrganization(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(RESET_ORG_OPERATION, { params: request.params, body: request.body });
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
  const organizationId = params.organizationId ?? '';
  if (!UUID_PATTERN.test(organizationId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;
  const body = parsed.data.body as ResetOrgBody;
  if (!body.confirm) {
    await sendProblem(
      reply,
      requestId,
      422,
      'field_validation',
      'Confirming this destructive change is required.',
    );
    return;
  }

  const digest = requestDigest({
    operation: OPERATION_ID_POLICY_RESET_ORGANIZATION,
    ...body,
    organizationId,
  });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(RESET_ORG_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_POLICY_RESET_ORGANIZATION,
      digest,
      execute: async (client) => {
        try {
          // A truly nonexistent organization is a closed 404 (idempotent success
          // is reserved for an existing organization with no override row).
          if (!(await organizationExists(client, organizationId))) {
            throw new ServiceError(404, 'not_found', 'The organization was not found.');
          }
          const result = await resetOrganizationOverride(client, {
            organizationId,
            expectedVersion: body.version,
            actorAccountId: session.accountId,
          });
          if (result.status === 'version_conflict') {
            throw new ServiceError(
              409,
              'version_conflict',
              'The policy was changed by another administrator.',
            );
          }
          if (result.status === 'temporarily_unavailable') {
            throw new ServiceError(
              503,
              'authority_unavailable',
              'Authority is temporarily unavailable.',
            );
          }
          // The only reachable status here is `reset` (version_conflict and
          // temporarily_unavailable throw above).
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'policy_reset_organization',
            target: { targetType: 'organization', organizationId },
            result: 'succeeded',
            requestId,
          });
          return { status: result.status };
        } catch (error) {
          throw toServiceError(error);
        }
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(RESET_ORG_OPERATION, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/**
 * POST /api/platform/v1/platform-admin/policy/projects/:projectId/limit — save
 * a project resource-limit override (admin only, CSRF + idempotent + audited).
 * `version: 0` with no limit row inserts version 1; a stale version is a closed
 * 409; a missing project is a closed 404.
 */
export async function handlePolicySetProjectLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(SET_PROJECT_LIMIT_OPERATION, {
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
  const params = request.params as { projectId?: string };
  const projectId = params.projectId ?? '';
  if (!UUID_PATTERN.test(projectId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;
  const body = parsed.data.body as SetProjectLimitBody;

  const digest = requestDigest({
    operation: OPERATION_ID_POLICY_SET_PROJECT_LIMIT,
    ...body,
    projectId,
  });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(SET_PROJECT_LIMIT_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_POLICY_SET_PROJECT_LIMIT,
      digest,
      execute: async (client) => {
        try {
          const result = await setProjectLimit(client, {
            projectId,
            resourceLimit: body.resourceLimit,
            expectedVersion: body.version,
            actorAccountId: session.accountId,
          });
          if (result.status === 'version_conflict') {
            throw new ServiceError(
              409,
              'version_conflict',
              'The policy was changed by another administrator.',
            );
          }
          if (result.status === 'project_not_found') {
            throw new ServiceError(404, 'not_found', 'The project was not found.');
          }
          if (result.status === 'temporarily_unavailable') {
            throw new ServiceError(
              503,
              'authority_unavailable',
              'Authority is temporarily unavailable.',
            );
          }
          // The only reachable status here is `set` (version_conflict,
          // project_not_found and temporarily_unavailable throw above).
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'policy_set_project_limit',
            target: { targetType: 'project', projectId },
            result: 'succeeded',
            requestId,
          });
          return { status: result.status, version: result.version };
        } catch (error) {
          throw toServiceError(error);
        }
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(SET_PROJECT_LIMIT_OPERATION, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/**
 * POST /api/platform/v1/platform-admin/policy/projects/:projectId/limit/clear —
 * clear a project resource-limit override (admin only, confirmed + CSRF +
 * idempotent + audited). A missing `confirm: true` is a closed 422; a stale
 * version is a closed 409.
 */
export async function handlePolicyClearProjectLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CLEAR_PROJECT_LIMIT_OPERATION, {
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
  const params = request.params as { projectId?: string };
  const projectId = params.projectId ?? '';
  if (!UUID_PATTERN.test(projectId)) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const session = await requirePlatformAdmin(request, reply, deps, requestId);
  if (session === null) return;
  const body = parsed.data.body as ClearProjectLimitBody;
  if (!body.confirm) {
    await sendProblem(
      reply,
      requestId,
      422,
      'field_validation',
      'Confirming this destructive change is required.',
    );
    return;
  }

  const digest = requestDigest({
    operation: OPERATION_ID_POLICY_CLEAR_PROJECT_LIMIT,
    ...body,
    projectId,
  });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(CLEAR_PROJECT_LIMIT_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_POLICY_CLEAR_PROJECT_LIMIT,
      digest,
      execute: async (client) => {
        try {
          // A truly nonexistent project is a closed 404 (idempotent success is
          // reserved for an existing project with no limit row).
          if (!(await projectExists(client, projectId))) {
            throw new ServiceError(404, 'not_found', 'The project was not found.');
          }
          const result = await clearProjectLimit(client, {
            projectId,
            expectedVersion: body.version,
            actorAccountId: session.accountId,
          });
          if (result.status === 'version_conflict') {
            throw new ServiceError(
              409,
              'version_conflict',
              'The policy was changed by another administrator.',
            );
          }
          if (result.status === 'temporarily_unavailable') {
            throw new ServiceError(
              503,
              'authority_unavailable',
              'Authority is temporarily unavailable.',
            );
          }
          // The only reachable status here is `cleared` (version_conflict and
          // temporarily_unavailable throw above).
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'policy_clear_project_limit',
            target: { targetType: 'project', projectId },
            result: 'succeeded',
            requestId,
          });
          return { status: result.status };
        } catch (error) {
          throw toServiceError(error);
        }
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(CLEAR_PROJECT_LIMIT_OPERATION, reply, requestId, idempotency.resultData);
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
