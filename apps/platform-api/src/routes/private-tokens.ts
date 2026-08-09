import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { getAccountById } from '@aurora/platform-identity';
import {
  createPrivateToken,
  listPrivateTokens,
  revokePrivateToken,
  verifyTokenScope,
  type PrivateTokenRow,
} from '@aurora/platform-credentials';
import {
  OPERATION_ID_LIST_PRIVATE_TOKENS,
  OPERATION_ID_CREATE_PRIVATE_TOKEN,
  OPERATION_ID_REVOKE_PRIVATE_TOKEN,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
import { withTransaction } from '../db.js';
import {
  orgNavigation,
  requireOrgManager,
  requireOrgManagerOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import {
  lookupIdempotency,
  requestDigest,
  runIdempotentCommand,
  type IdempotentCommandResult,
} from '../idempotency.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_PRIVATE_TOKENS_OPERATION: OperationDef = operationById(OPERATION_ID_LIST_PRIVATE_TOKENS);
const CREATE_PRIVATE_TOKEN_OPERATION: OperationDef = operationById(
  OPERATION_ID_CREATE_PRIVATE_TOKEN,
);
const REVOKE_PRIVATE_TOKEN_OPERATION: OperationDef = operationById(
  OPERATION_ID_REVOKE_PRIVATE_TOKEN,
);

interface CreatePrivateTokenBody {
  readonly name: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: string;
  readonly idempotencyKey: string;
}

interface PrivateTokenPathParams {
  readonly organizationId: string;
  readonly tokenId: string;
}

/**
 * T4 carry-forward (Plaintext-NEVER-persisted + idempotency): the
 * `credentialsCreatePrivateTokenResponse` REQUIRES `tokenPlaintext` (zod strict
 * object), so the idempotency record cannot omit the field entirely and still
 * replay a contract-closed 200. The resolution: the idempotency record stores
 * the create result with a fixed NON-secret placeholder in place of the real
 * plaintext:
 *
 *   stored result_data = { tokenId, tokenPlaintext: SECRET_LOST_PLACEHOLDER, scopes, expiresAt? }
 *
 * The real one-time plaintext is captured in the first-run transaction and
 * attached ONLY to the first successful response (Cache-Control: no-store); it
 * is never written to `idempotency_records.result_data`. A same-key retry
 * replays the stored placeholder, so the caller who lost the first response can
 * detect that the secret is unrecoverable (revoke + re-create), no second token
 * row is created, and the DB never holds the plaintext. The placeholder is a
 * fixed non-token string (real tokens start `aurora_pt_`), so it is never
 * mistaken for a secret.
 */
const SECRET_LOST_PLACEHOLDER = 'secret-not-recoverable-0000000000';

/**
 * GET /api/platform/v1/organizations/:organizationId/private-tokens — B6 list
 * (owner/admin only). METADATA ONLY: never the digest and never the plaintext
 * (the plaintext no longer exists server-side after the one-time create
 * response). `revokedAt`/`lastUsedAt`/`expiresAt` are omitted when null.
 */
export async function handleListPrivateTokens(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(LIST_PRIVATE_TOKENS_OPERATION, { params: request.params });
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

  let permissions;
  try {
    permissions = await effectivePermissions(session.accountId, organizationId, deps);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (!(await requireOrgManager(permissions, reply, requestId))) return;

  let tokens: PrivateTokenRow[];
  try {
    tokens = await listPrivateTokens(deps.pool, organizationId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = {
    tokens: tokens.map((token) => toTokenSummary(token)),
    navigationTargets: orgNavigation('organization.tokens', organizationId),
  };

  const serialized = serializeOutput(LIST_PRIVATE_TOKENS_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/private-tokens — B6 create
 * (owner/admin only, idempotent, CSRF via plugins). PRD §4.1: the ACTOR's email
 * must be verified (403 authorization otherwise). Scopes must be on the fixed
 * public allowlist (`verifyTokenScope`) → 422 field_validation otherwise. The
 * plaintext is delivered exactly once in the first successful response with
 * `Cache-Control: no-store`; see SECRET_LOST_PLACEHOLDER for the idempotency
 * carry-forward resolution.
 */
export async function handleCreatePrivateToken(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(CREATE_PRIVATE_TOKEN_OPERATION, {
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

  const params = request.params as { organizationId?: string };
  if (!requireUuidParams(params, reply, requestId)) return;
  const organizationId = params.organizationId ?? '';
  const input = parsed.data.body as CreatePrivateTokenBody;

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

  // PRD §4.1 verified-email gate for the ACTOR (spec §6 B6 permission). 403
  // authorization: the capability is unavailable while the actor's own email is
  // unverified (the actor is the account owner, so this reveals no third-party
  // state).
  let actorAccount;
  try {
    actorAccount = await getAccountById(deps.pool, session.accountId);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
  if (actorAccount === null || actorAccount.verifiedAt === null) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'A verified email is required to create private tokens.',
    );
    return;
  }

  // Scope allowlist: spec §9 maps an illegal scope to 422 field_validation. The
  // data layer also enforces the allowlist (invalid_input → 400), but the spec
  // requires 422 here, so the handler pre-validates and emits the field error.
  if (!verifyTokenScope(input.scopes)) {
    await sendProblem(
      reply,
      requestId,
      422,
      'field_validation',
      'Token scopes must be non-empty and from the allowed set.',
      {
        fieldErrors: [{ field: 'scopes', reason: 'Scope is not in the allowed set.' }],
      },
    );
    return;
  }

  const digest = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    const serialized = serializeOutput(CREATE_PRIVATE_TOKEN_OPERATION, 200, probe.resultData);
    if (!serialized.ok) {
      await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
      return;
    }
    void reply
      .header('cache-control', 'no-store')
      .header('x-aurora-request-id', requestId)
      .code(200)
      .send(serialized.body);
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

  // Captured only inside the first-run transaction; never persisted, only
  // attached to the first successful response.
  let firstRunPlaintext: string | null = null;

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_CREATE_PRIVATE_TOKEN,
      digest,
      execute: async (client) => {
        await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
        const result = await createPrivateToken(client, {
          orgId: organizationId,
          createdBy: session.accountId,
          name: input.name,
          scopes: input.scopes,
          expiresAt: input.expiresAt === undefined ? null : new Date(input.expiresAt),
        });
        firstRunPlaintext = result.tokenPlaintext;
        return {
          tokenId: result.tokenId,
          // The stored idempotency payload NEVER carries the real plaintext.
          tokenPlaintext: SECRET_LOST_PLACEHOLDER,
          scopes: result.scopes,
          ...(result.expiresAt === null ? {} : { expiresAt: result.expiresAt }),
        };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  const stored = idempotency.resultData as {
    tokenId: string;
    tokenPlaintext: string;
    scopes: readonly string[];
    expiresAt?: string;
  };
  // First run: attach the real one-time plaintext. Replay: keep the placeholder
  // (the caller already received the real secret on the first response, or lost
  // it and must revoke + re-create).
  const body =
    idempotency.outcome === 'succeeded' && firstRunPlaintext !== null
      ? { ...stored, tokenPlaintext: firstRunPlaintext }
      : stored;

  const serialized = serializeOutput(CREATE_PRIVATE_TOKEN_OPERATION, 200, body);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply
    .header('cache-control', 'no-store')
    .header('x-aurora-request-id', requestId)
    .code(200)
    .send(serialized.body);
}

/**
 * POST /api/platform/v1/organizations/:organizationId/private-tokens/:tokenId/revoke —
 * B6 revoke a private token (owner/admin only). Irreversible: once `revoked_at`
 * is set the token is terminal and never reactivated. Org scoping is enforced at
 * the service layer: the token must belong to THIS organization (read via
 * `listPrivateTokens`), else 404 not_found (a cross-org or unknown token id is
 * never confirmed). Re-revoking an already-revoked token is idempotent at the
 * data layer (success, no duplicate audit).
 */
export async function handleRevokePrivateToken(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(REVOKE_PRIVATE_TOKEN_OPERATION, { params: request.params });
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

  const params = request.params as PrivateTokenPathParams;
  if (
    !requireUuidParams(params as unknown as Readonly<Record<string, unknown>>, reply, requestId)
  ) {
    return;
  }
  const organizationId = params.organizationId;
  const tokenId = params.tokenId;

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

  try {
    await withTransaction(deps.pool, async (client) => {
      await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
      await assertTokenInOrg(client, organizationId, tokenId);
      const result = await revokePrivateToken(client, {
        tokenId,
        actorId: session.accountId,
      });
      if (result.status === 'not_found') {
        throw new ServiceError(404, 'not_found', 'The token was not found.');
      }
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = { status: 'succeeded' as const, tokenId };
  const serialized = serializeOutput(REVOKE_PRIVATE_TOKEN_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/** Project the metadata-only token summary (no digest, no plaintext). */
function toTokenSummary(token: PrivateTokenRow): {
  tokenId: string;
  name: string;
  scopes: readonly string[];
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
} {
  return {
    tokenId: token.tokenId,
    name: token.name,
    scopes: token.scopes,
    ...(token.expiresAt === null ? {} : { expiresAt: token.expiresAt }),
    ...(token.revokedAt === null ? {} : { revokedAt: token.revokedAt }),
    ...(token.lastUsedAt === null ? {} : { lastUsedAt: token.lastUsedAt }),
  };
}

/** Org-scoping guard for revoke: the token must be in THIS organization's list. */
async function assertTokenInOrg(client: PoolClient, orgId: string, tokenId: string): Promise<void> {
  const tokens = await listPrivateTokens(client, orgId);
  const match = tokens.some((token) => token.tokenId === tokenId);
  if (!match) {
    throw new ServiceError(404, 'not_found', 'The token was not found.');
  }
}
