import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  grantPlatformAdmin,
  insertPlatformAuditEvent,
  isPlatformAdmin,
  listPlatformAdmins,
  queryPlatformAuditEvents,
  revokePlatformAdmin,
  type PlatformAdminSummary,
  type PlatformAuditEvent,
} from '@aurora/platform-admin';
import {
  OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY,
  OPERATION_ID_PLATFORM_ADMIN_GRANT,
  OPERATION_ID_PLATFORM_ADMIN_LIST,
  OPERATION_ID_PLATFORM_ADMIN_REVOKE,
  OPERATION_ID_PLATFORM_AUDIT_LIST,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import { requirePlatformAdmin, requireSession, UUID_PATTERN } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const CAPABILITY_OPERATION: OperationDef = operationById(
  OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY,
);
const LIST_OPERATION: OperationDef = operationById(OPERATION_ID_PLATFORM_ADMIN_LIST);
const GRANT_OPERATION: OperationDef = operationById(OPERATION_ID_PLATFORM_ADMIN_GRANT);
const REVOKE_OPERATION: OperationDef = operationById(OPERATION_ID_PLATFORM_ADMIN_REVOKE);
const AUDIT_LIST_OPERATION: OperationDef = operationById(OPERATION_ID_PLATFORM_AUDIT_LIST);

/** Drop null projection fields (exactOptionalPropertyTypes-safe). */
function toContractAdmin(row: PlatformAdminSummary): Record<string, unknown> {
  return {
    accountId: row.accountId,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt,
  };
}

/** Drop null projection fields for a platform audit event (exactOptionalPropertyTypes-safe). */
function toContractAuditEvent(row: PlatformAuditEvent): Record<string, unknown> {
  return {
    eventId: row.eventId,
    action: row.action,
    actorAccountId: row.actorAccountId,
    target: row.target,
    result: row.result,
    occurredAt: row.occurredAt,
    ...(row.requestId === undefined ? {} : { requestId: row.requestId }),
  };
}

/**
 * Write an `audit_read` platform audit event on a dedicated connection (released
 * after). The capability GET deliberately does NOT audit (it is callable by any
 * authenticated session and would flood the platform audit timeline); the
 * admin-list and audit-list reads do, so every admin read is itself traceable.
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

/**
 * GET /api/platform/v1/platform-admin/capability — D2 capability probe. Session
 * only (NOT admin-gated): every authenticated session may resolve whether it
 * holds the platform admin capability. Reads `platform_admins` fresh (never
 * cached) and writes no audit event (an unauthenticated-gated read must not
 * flood the platform audit timeline).
 */
export async function handleGetPlatformAdminCapability(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CAPABILITY_OPERATION, {
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
  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let hasCapability;
  try {
    hasCapability = await isPlatformAdmin(deps.pool, { accountId: session.accountId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = { data: { hasCapability } };
  const serialized = serializeOutput(CAPABILITY_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/platform-admin/admins — list platform admin identities
 * with grant provenance (admin only). The list read itself is audited with an
 * `audit_read` event; a non-admin is closed 403 with no platform data leaked.
 */
export async function handleListPlatformAdmins(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_OPERATION, { params: request.params, query: request.query });
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

  let page;
  try {
    await writeAuditRead(deps, session.accountId, requestId, 'platform_admins');
    page = await listPlatformAdmins(deps.pool, {});
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data: {
      admins: {
        status: 'available' as const,
        items: page.items.map(toContractAdmin),
        pagination: {
          totalCount: page.items.length,
          totalCountStatus: 'available' as const,
        },
      },
    },
    meta: { requestId, readAt: deps.now().toISOString() },
    allowedActions: ['read'] as const,
    navigationTargets: [],
  };

  const serialized = serializeOutput(LIST_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/platform-admin/admins/:accountId/grant — grant the
 * platform admin capability to an existing account (admin only, CSRF +
 * idempotent + audited). On a real grant (`granted`) an `admin_granted` audit
 * event is written INSIDE the idempotency transaction, so the grant, its audit
 * and the idempotency record commit atomically (a replay never re-writes).
 * `account_not_found` is a closed 404; a DB failure fails closed 503.
 */
export async function handleGrantPlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(GRANT_OPERATION, { params: request.params, body: request.body });
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
  const params = request.params as { accountId?: string };
  const accountId = params.accountId ?? '';
  if (!UUID_PATTERN.test(accountId)) {
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
  const body = parsed.data.body as { idempotencyKey: string };

  // The digest must cover the operation AND the path `accountId` as well as the
  // body: two different-target requests (or a grant vs. a revoke of the same
  // target) reusing the same idempotency key would otherwise produce the same
  // digest and silently replay the first stored result.
  const digest = requestDigest({
    operation: OPERATION_ID_PLATFORM_ADMIN_GRANT,
    ...body,
    accountId,
  });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(GRANT_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_PLATFORM_ADMIN_GRANT,
      digest,
      execute: async (client) => {
        const result = await grantPlatformAdmin(client, {
          accountId,
          grantedBy: session.accountId,
        });
        if (result.status === 'account_not_found') {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }
        if (result.status === 'temporarily_unavailable') {
          throw new ServiceError(
            503,
            'authority_unavailable',
            'Authority is temporarily unavailable.',
          );
        }
        if (result.status === 'granted') {
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'admin_granted',
            target: { targetType: 'account', accountId },
            result: 'succeeded',
            requestId,
          });
        }
        return { status: result.status, accountId };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(GRANT_OPERATION, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/**
 * POST /api/platform/v1/platform-admin/admins/:accountId/revoke — revoke the
 * platform admin capability (admin only, CSRF + idempotent + audited). On a
 * real revoke (`revoked`) an `admin_revoked` audit event is written INSIDE the
 * idempotency transaction. `last_admin` is a closed 409 `state_machine_conflict`
 * that rolls back with NO audit write (the capability is never removed); a DB
 * failure fails closed 503. `not_admin` is a valid idempotent outcome with no
 * audit (no state change).
 */
export async function handleRevokePlatformAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(REVOKE_OPERATION, { params: request.params, body: request.body });
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
  const params = request.params as { accountId?: string };
  const accountId = params.accountId ?? '';
  if (!UUID_PATTERN.test(accountId)) {
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
  const body = parsed.data.body as { idempotencyKey: string };

  // The digest must cover the operation AND the path `accountId` as well as the
  // body (see grant): a grant and a revoke of the same target reusing the same
  // idempotency key must NOT silently replay each other's stored result.
  const digest = requestDigest({
    operation: OPERATION_ID_PLATFORM_ADMIN_REVOKE,
    ...body,
    accountId,
  });
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(REVOKE_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_PLATFORM_ADMIN_REVOKE,
      digest,
      execute: async (client) => {
        const result = await revokePlatformAdmin(client, {
          accountId,
          revokedBy: session.accountId,
        });
        if (result.status === 'last_admin') {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'The last platform admin cannot be revoked.',
          );
        }
        if (result.status === 'temporarily_unavailable') {
          throw new ServiceError(
            503,
            'authority_unavailable',
            'Authority is temporarily unavailable.',
          );
        }
        if (result.status === 'revoked') {
          await insertPlatformAuditEvent(client, {
            actorAccountId: session.accountId,
            action: 'admin_revoked',
            target: { targetType: 'account', accountId },
            result: 'succeeded',
            requestId,
          });
        }
        return { status: result.status, accountId };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(REVOKE_OPERATION, reply, requestId, idempotency.resultData);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

/**
 * GET /api/platform/v1/platform-admin/audit — list the platform-level audit
 * timeline (admin only, 1-year retention, separate from B7). The read itself is
 * audited with an `audit_read` event so the audit timeline is fully traceable.
 */
export async function handleListPlatformAuditEvents(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(AUDIT_LIST_OPERATION, {
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
  const query = parsed.data.query as { cursor?: string; limit?: number };

  let page;
  try {
    await writeAuditRead(deps, session.accountId, requestId, 'platform_audit_events');
    page = await queryPlatformAuditEvents(deps.pool, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data: {
      events: {
        status: 'available' as const,
        items: page.items.map(toContractAuditEvent),
        pagination: {
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          totalCount: page.items.length,
          totalCountStatus: 'available' as const,
        },
      },
    },
    meta: { requestId, readAt: deps.now().toISOString() },
    allowedActions: ['read'] as const,
    navigationTargets: [],
  };

  const serialized = serializeOutput(AUDIT_LIST_OPERATION, 200, body);
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
