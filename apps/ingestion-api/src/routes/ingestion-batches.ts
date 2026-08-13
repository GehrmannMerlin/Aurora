import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { parseIngestionBatchRequest } from '@aurora/event-schema';
import type {
  PersistIngestionBatchResult,
  PersistIngestionBatchInput,
} from '@aurora/ingestion-inbox';
import type { IngestionRequestAuthorizer } from '../access-policy.js';
import type { IngestionAdmissionPolicy } from '../admission-policy.js';
import type { IngestionRequestIdProvider } from '../request-id.js';
import { mapPersistResultsToEventReceipts } from '../receipt-mapper.js';
import { mapErrorToHttp } from '../error-mapper.js';
import { isPreflightAllowed, validatePreflightOrigin } from '../cors.js';

export interface PersistIngestionBatchPort {
  persistBatch(pool: Pool, input: PersistIngestionBatchInput): Promise<PersistIngestionBatchResult>;
}

export interface RouteDependencies {
  readonly pool: Pool;
  readonly requestIdProvider: IngestionRequestIdProvider;
  readonly authorizer: IngestionRequestAuthorizer;
  readonly admissionPolicy: IngestionAdmissionPolicy;
  readonly persist: PersistIngestionBatchPort;
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

export async function handlePostBatches(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: RouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const clientKey = readHeader(request, 'X-Aurora-Client-Key');
  const environment = readHeader(request, 'X-Aurora-Environment');
  if (clientKey === undefined || clientKey === '') {
    await reply.code(401).send({ requestId, message: 'missing client key' });
    return;
  }
  if (environment === undefined || environment === '') {
    await reply.code(400).send({ requestId, message: 'missing environment header' });
    return;
  }
  const origin = readHeader(request, 'origin');

  const auth = await deps.authorizer.authorize({
    clientKey,
    environment,
    origin,
    requestId,
  });
  if (auth.status !== 'authorized') {
    if (auth.status === 'unauthenticated') {
      await reply.code(401).send({ requestId, message: 'invalid client key' });
      return;
    }
    if (auth.status === 'originForbidden' || auth.status === 'environmentForbidden') {
      await reply.code(403).send({ requestId, message: 'forbidden' });
      return;
    }
    await reply.code(503).send({ requestId, message: 'temporarily unavailable' });
    return;
  }
  const { projectId } = auth;

  // Peek the parsed body only to count events for admission (rate-limit on the
  // ING-13 sustainable event rate); the body is re-parsed/validated below.
  const bodyPeek = request.body;
  const eventCount =
    typeof bodyPeek === 'object' &&
    bodyPeek !== null &&
    Array.isArray((bodyPeek as { events?: unknown }).events)
      ? (bodyPeek as { events: unknown[] }).events.length
      : undefined;

  const admission = await deps.admissionPolicy.check(
    eventCount === undefined ? { requestId } : { requestId, eventCount },
  );
  if (admission.status === 'temporarilyRejected') {
    const retryAfter = String(Math.ceil(admission.retryAfterMs / 1000));
    void reply.header('Retry-After', retryAfter);
    await reply.code(429).send({
      batchState: 'temporarily_failed',
      errorCode: 'rate_limited',
      retryable: true,
      retryAfterMs: admission.retryAfterMs,
      perEventResults: [],
    });
    return;
  }

  const body: unknown = request.body;
  if (body === undefined || typeof body !== 'object' || body === null) {
    await reply.code(400).send({ requestId, message: 'malformed JSON' });
    return;
  }
  const parsed = parseIngestionBatchRequest(body);
  if (!parsed.success) {
    await reply.code(400).send({ requestId, message: 'invalid batch' });
    return;
  }

  let persistResult: PersistIngestionBatchResult;
  try {
    const input: PersistIngestionBatchInput = {
      projectId,
      events: parsed.data.events.map((event, index) => ({ batchIndex: index, event })),
      ...(parsed.data.receivedAt === undefined ? {} : { receivedAt: parsed.data.receivedAt }),
    };
    persistResult = await deps.persist.persistBatch(deps.pool, input);
  } catch (error) {
    const mapped = mapErrorToHttp(requestId, error as Error);
    await reply.code(mapped.statusCode).send(mapped.body);
    return;
  }

  const perEventResults = mapPersistResultsToEventReceipts(persistResult.perEventResults);
  void reply.code(200).header('X-Aurora-Request-Id', requestId).send({
    batchState: 'accepted',
    errorCode: 'batch_accepted',
    retryable: false,
    perEventResults,
  });
}

export interface PreflightValidation {
  readonly origin: string | null;
  readonly allowed: boolean;
}

export function validateOptionsRequest(request: FastifyRequest): PreflightValidation {
  const originHeader = readHeader(request, 'origin');
  const origin = validatePreflightOrigin(originHeader);
  if (origin === null) return { origin: null, allowed: false };
  const method = request.headers['access-control-request-method'];
  const methodValue =
    typeof method === 'string' ? method : Array.isArray(method) ? method[0] : undefined;
  const requestedHeaders = readHeader(request, 'access-control-request-headers');
  const headers =
    requestedHeaders === undefined ? [] : requestedHeaders.split(',').map((h) => h.trim());
  const allowed = isPreflightAllowed(methodValue, headers);
  return { origin, allowed };
}
