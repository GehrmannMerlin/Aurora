import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  markNotificationRead,
  queryNotifications,
  queryUnreadCount,
  type NotificationRow,
} from '@aurora/processing-store';
import {
  OPERATION_ID_NOTIFICATIONS_LIST,
  OPERATION_ID_NOTIFICATIONS_MARK_READ,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import { requireSession, UUID_PATTERN } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_OPERATION: OperationDef = operationById(OPERATION_ID_NOTIFICATIONS_LIST);
const MARK_READ_OPERATION: OperationDef = operationById(OPERATION_ID_NOTIFICATIONS_MARK_READ);

/** Drop null projection fields (exactOptionalPropertyTypes-safe). */
function toContractNotification(row: NotificationRow): Record<string, unknown> {
  return {
    notificationId: row.notificationId,
    type: row.type,
    title: row.title,
    ...(row.summary === null ? {} : { summary: row.summary }),
    ...(row.organizationId === null ? {} : { organizationId: row.organizationId }),
    ...(row.projectId === null ? {} : { projectId: row.projectId }),
    occurredAt: row.occurredAt,
    ...(row.readAt === null ? {} : { readAt: row.readAt }),
    target: row.target,
  };
}

/**
 * GET /api/platform/v1/notifications — D1 account-level notification list with
 * the unread count (`account.notifications` Route Target). Session-scoped: the
 * list and count are the CURRENT session account's rows only; a cross-account
 * notification is never readable. Keyset pagination via `nextCursor`; the
 * `unreadCount` reflects the same account at read time. A DB authority failure
 * maps to 503 (stable data-layer mapping), never a fabricated zero.
 */
export async function handleListNotifications(
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
  const session = await requireSession(request, reply, requestId);
  if (session === null) return;
  const query = parsed.data.query as { readState?: string; cursor?: string; limit?: number };

  let page;
  let unread;
  try {
    [page, unread] = await Promise.all([
      queryNotifications(deps.pool, {
        accountId: session.accountId,
        readState: query.readState === 'unread' ? 'unread' : 'all',
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
      queryUnreadCount(deps.pool, { accountId: session.accountId }),
    ]);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data: {
      notifications: {
        status: 'available' as const,
        items: page.items.map(toContractNotification),
        pagination: {
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          totalCount: page.items.length,
          totalCountStatus: 'available' as const,
        },
      },
      unreadCount: {
        value: unread,
        status: 'available' as const,
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
 * POST /api/platform/v1/notifications/:notificationId/read — mark one account
 * notification read (idempotent, account-scoped). The mark-read and its
 * idempotency record commit in one transaction; a cross-account notification is
 * a closed 404 and replay never re-writes. Marking read only tracks the entry,
 * never the underlying business issue/alert state.
 */
export async function handleMarkNotificationRead(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(MARK_READ_OPERATION, {
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
  const params = request.params as { notificationId?: string };
  const notificationId = params.notificationId ?? '';
  if (!UUID_PATTERN.test(notificationId)) {
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
  const body = parsed.data.body as { idempotencyKey: string };

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(MARK_READ_OPERATION, reply, requestId, probe.resultData);
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
      operation: OPERATION_ID_NOTIFICATIONS_MARK_READ,
      digest,
      execute: async (client) => {
        const result = await markNotificationRead(client, {
          accountId: session.accountId,
          notificationId,
        });
        if (result.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The notification was not found.');
        }
        return { status: 'read', notificationId: result.notificationId };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    await sendSerialized(MARK_READ_OPERATION, reply, requestId, idempotency.resultData);
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
