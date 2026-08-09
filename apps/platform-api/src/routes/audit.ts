import type { FastifyReply, FastifyRequest } from 'fastify';
import { listAuditEvents } from '@aurora/platform-audit';
import { OPERATION_ID_LIST_SECURITY_AUDIT } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import { requireOrgManager, requireSession, requireUuidParams } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_SECURITY_AUDIT_OPERATION: OperationDef = operationById(OPERATION_ID_LIST_SECURITY_AUDIT);

interface AuditQuery {
  readonly cursor?: string;
  readonly limit: number;
}

/**
 * GET /api/platform/v1/organizations/:organizationId/audit — B7 read-only
 * security-audit timeline (owner/admin only; a plain member gets a closed 403
 * and NO audit metadata is leaked — the repository is never called for a
 * non-manager, spec §6 B7). The data layer returns redacted summaries
 * (`actorMasked`, stable action, no password/token/email body) with the B7
 * 1-year retention window and cursor pagination. The contract `limit` is a
 * number, so the handler coerces the string querystring value before
 * `parseInput` (a non-numeric/missing limit → structural 400).
 */
export async function handleListSecurityAudit(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const rawQuery = request.query as Record<string, unknown>;
  const rawLimit = rawQuery.limit;
  const limit = typeof rawLimit === 'string' ? Number(rawLimit) : rawLimit;
  const query = { ...rawQuery, limit };

  const parsed = parseInput(LIST_SECURITY_AUDIT_OPERATION, {
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

  const params = request.params as { organizationId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const input = parsed.data.query as AuditQuery;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  let result;
  try {
    result = await listAuditEvents(deps.pool, {
      orgId: organizationId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = {
    events: result.events.map((event) => ({
      eventId: event.eventId,
      action: event.action,
      occurredAt: event.occurredAt,
      result: event.result,
      actorMasked: event.actorMasked,
      ...(event.targetProjectRef === undefined
        ? {}
        : { targetProjectRef: { projectId: event.targetProjectRef.projectId } }),
    })),
    pagination: result.pagination,
  };

  const serialized = serializeOutput(LIST_SECURITY_AUDIT_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
