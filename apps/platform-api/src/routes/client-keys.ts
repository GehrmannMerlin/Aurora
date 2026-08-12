import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  OPERATION_ID_CREDENTIALS_CREATE,
  OPERATION_ID_CREDENTIALS_DISABLE,
  OPERATION_ID_CREDENTIALS_ENABLE,
  OPERATION_ID_CREDENTIALS_LIST,
  OPERATION_ID_CREDENTIALS_REVOKE,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import {
  createIngestionClientCredential,
  disableIngestionClientCredential,
  enableIngestionClientCredential,
  listIngestionClientCredentials,
  revokeIngestionClientCredential,
} from '@aurora/ingestion-credentials';
import { insertAuditEvent } from '@aurora/platform-identity';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import { withTransaction } from '../db.js';
import {
  projectNavigation,
  requireProjectAccess,
  requireProjectAdminAccess,
  requireProjectAdminAccessOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import { lookupIdempotency, requestDigest, runIdempotentCommand } from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_OP = operationById(OPERATION_ID_CREDENTIALS_LIST);
const CREATE_OP = operationById(OPERATION_ID_CREDENTIALS_CREATE);
const DISABLE_OP = operationById(OPERATION_ID_CREDENTIALS_DISABLE);
const ENABLE_OP = operationById(OPERATION_ID_CREDENTIALS_ENABLE);
const REVOKE_OP = operationById(OPERATION_ID_CREDENTIALS_REVOKE);

/**
 * The idempotency record for create stores this fixed NON-secret placeholder in
 * place of the real one-time client key (mirrors private-tokens). A same-key
 * retry replays the placeholder so the caller who lost the first response can
 * detect that the secret is unrecoverable (revoke + re-create); the DB never
 * holds the plaintext.
 */
const SECRET_LOST_PLACEHOLDER = 'secret-not-recoverable-000000000000';

interface ClientKeyProjectParams {
  readonly organizationId: string;
  readonly projectId: string;
}

/** Conditionally include the actor field (exactOptionalPropertyTypes-safe). */
function actorField(
  accountId: string | undefined,
): { actorAccountId: string } | Record<string, never> {
  return accountId === undefined ? {} : { actorAccountId: accountId };
}

/** Session + org membership + project view access (shared by all C14 handlers). */
async function authorizeClientKeyView(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
  requestId: string,
): Promise<ClientKeyProjectParams | null> {
  const params = request.params as ClientKeyProjectParams;
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

/** GET .../client-keys — metadata-only list (C14). */
export async function handleListClientKeys(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(LIST_OP, { params: request.params });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeClientKeyView(request, reply, deps, requestId);
  if (auth === null) return;

  let keys;
  try {
    keys = await listIngestionClientCredentials(deps.pool, { projectId: auth.projectId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const body = {
    data:
      keys.length === 0
        ? { status: 'empty' as const, reason: 'no client keys' }
        : {
            status: 'available' as const,
            data: {
              items: keys.map((key) => ({
                credentialId: key.credentialId,
                keyId: key.keyId,
                status: key.status,
                allowNonBrowser: key.allowNonBrowser,
                ...(key.expiresAt === null ? {} : { expiresAt: key.expiresAt }),
                origins: key.origins,
                environments: key.environments,
                createdAt: key.createdAt,
                updatedAt: key.updatedAt,
              })),
            },
          },
    meta: { requestId, readAt: deps.now().toISOString(), normalizedQuery: {} },
    allowedActions: ['read'],
    navigationTargets: projectNavigation('project.client-keys', auth.organizationId, auth.projectId),
  };

  const serialized = serializeOutput(LIST_OP, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

interface CreateClientKeyBody {
  readonly origins: readonly string[];
  readonly environments: readonly string[];
  readonly allowNonBrowser: boolean;
  readonly expiresAt?: string;
  readonly idempotencyKey: string;
}

/** POST .../client-keys — create with one-time clientKey delivery (C14). */
export async function handleCreateClientKey(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(CREATE_OP, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const auth = await authorizeClientKeyView(request, reply, deps, requestId);
  if (auth === null) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectAdminAccess(
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
  const body = parsed.data.body as CreateClientKeyBody;

  const digest = requestDigest(body);
  const probe = await lookupIdempotency(deps.pool, body.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    await sendSerialized(CREATE_OP, reply, requestId, probe.resultData);
    return;
  }
  if (probe.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key was used with a different request.');
    return;
  }

  // Captured only inside the first-run transaction; never persisted, only
  // attached to the first successful response.
  const firstRunClientKey: { value: string | null } = { value: null };

  try {
    const idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: body.idempotencyKey,
      operation: OPERATION_ID_CREDENTIALS_CREATE,
      digest,
      execute: async (client) => {
        await requireProjectAdminAccessOnTransaction(client, session?.accountId ?? '', auth.organizationId, auth.projectId);
        const result = await createIngestionClientCredential(client, {
          projectId: auth.projectId,
          origins: [...body.origins],
          environments: [...body.environments],
          allowNonBrowser: body.allowNonBrowser,
          expiresAt: body.expiresAt === undefined ? null : new Date(body.expiresAt),
        });
        if (result.status !== 'success') {
          if (result.status === 'invalid_input') {
            throw new ServiceError(422, 'field_validation', 'Client key input is invalid.');
          }
          throw new ServiceError(503, 'authority_unavailable', 'Client key store unavailable.');
        }
        firstRunClientKey.value = result.clientKey;
        await insertAuditEvent(client, {
          organizationId: auth.organizationId,
          ...actorField(session?.accountId),
          action: 'client_key.created',
          details: { projectId: auth.projectId, keyId: result.metadata.keyId },
        });
        return {
          status: 'created',
          credentialId: result.metadata.credentialId,
          keyId: result.metadata.keyId,
          // The stored idempotency payload NEVER carries the real secret.
          clientKey: SECRET_LOST_PLACEHOLDER,
          ...(result.metadata.expiresAt === null ? {} : { expiresAt: result.metadata.expiresAt }),
          origins: body.origins,
          environments: body.environments,
        };
      },
    });
    if (idempotency.outcome === 'conflict') {
      await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
      return;
    }
    const stored = idempotency.resultData as {
      status: string;
      credentialId: string;
      keyId: string;
      clientKey: string;
      expiresAt?: string;
      origins: readonly string[];
      environments: readonly string[];
    };
    const responseData =
      idempotency.outcome === 'succeeded' && firstRunClientKey.value !== null
        ? { ...stored, clientKey: firstRunClientKey.value }
        : stored;
    await sendSerialized(CREATE_OP, reply, requestId, responseData, true);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}

interface ClientKeyPathParams {
  readonly organizationId: string;
  readonly projectId: string;
  readonly keyId: string;
}

function requireKeyId(value: unknown, reply: FastifyReply, requestId: string): boolean {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return false;
  }
  return true;
}

/** Shared body for disable/enable/revoke. The idempotency key is contract-
 * validated by parseInput; the status machine itself is idempotent, so no
 * idempotency record is written for these transitions. */
interface ClientKeyMutationBody {
  readonly idempotencyKey: string;
}

async function handleKeyMutation(
  op: OperationDef,
  transition: 'disable' | 'enable' | 'revoke',
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const parsed = parseInput(op, { params: request.params, body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const params = request.params as ClientKeyPathParams;
  if (
    !requireUuidParams({ organizationId: params.organizationId, projectId: params.projectId }, reply, requestId)
  ) {
    return;
  }
  if (!requireKeyId(params.keyId, reply, requestId)) return;
  const auth = await authorizeClientKeyView(request, reply, deps, requestId);
  if (auth === null) return;
  const session = request.sessionPayload;
  if (
    !(await requireProjectAdminAccess(
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
  const body = parsed.data.body as ClientKeyMutationBody;
  void body.idempotencyKey;

  let result;
  try {
    if (transition === 'disable') {
      result = await disableIngestionClientCredential(deps.pool, { keyId: params.keyId });
    } else if (transition === 'enable') {
      result = await enableIngestionClientCredential(deps.pool, { keyId: params.keyId });
    } else {
      result = await revokeIngestionClientCredential(deps.pool, { keyId: params.keyId });
    }
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (result.status !== 'success') {
    if (result.status === 'not_found') {
      await sendProblem(reply, requestId, 404, 'not_found', 'The client key was not found.');
      return;
    }
    if (result.status === 'invalid_state') {
      await sendProblem(
        reply,
        requestId,
        409,
        'state_machine_conflict',
        'The client key is not in a state that allows this transition.',
      );
      return;
    }
    if (result.status === 'expired') {
      await sendProblem(reply, requestId, 409, 'state_machine_conflict', 'The client key is expired.');
      return;
    }
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Client key store unavailable.');
    return;
  }

  // The lifecycle mutate owns its own transaction; the audit row is written in a
  // separate transaction after the state change commits.
  try {
    await withTransaction(deps.pool, async (client) => {
      await insertAuditEvent(client, {
        organizationId: auth.organizationId,
        ...actorField(session?.accountId),
        action:
          transition === 'disable'
            ? 'client_key.disabled'
            : transition === 'enable'
              ? 'client_key.enabled'
              : 'client_key.revoked',
        details: { projectId: auth.projectId, keyId: params.keyId },
      });
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  await sendSerialized(op, reply, requestId, {
    status: transition === 'disable' ? 'disabled' : transition === 'enable' ? 'enabled' : 'revoked',
    credentialId: result.metadata.credentialId,
    keyId: result.metadata.keyId,
  });
}

/** POST .../client-keys/:keyId/disable (C14). */
export async function handleDisableClientKey(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  await handleKeyMutation(DISABLE_OP, 'disable', request, reply, deps);
}

/** POST .../client-keys/:keyId/enable (C14). */
export async function handleEnableClientKey(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  await handleKeyMutation(ENABLE_OP, 'enable', request, reply, deps);
}

/** POST .../client-keys/:keyId/revoke — irreversible (C14). */
export async function handleRevokeClientKey(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  await handleKeyMutation(REVOKE_OP, 'revoke', request, reply, deps);
}

/** Serialize a command response; used for both first-run and idempotent replay. */
async function sendSerialized(
  operation: OperationDef,
  reply: FastifyReply,
  requestId: string,
  data: unknown,
  noStore = false,
): Promise<void> {
  const serialized = serializeOutput(operation, 200, { data });
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  if (noStore) void reply.header('cache-control', 'no-store');
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
