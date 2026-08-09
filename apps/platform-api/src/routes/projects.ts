import type { FastifyReply, FastifyRequest } from 'fastify';
import { createProject } from '@aurora/platform-project-governance';
import { OPERATION_ID_CREATE_PROJECT } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { effectivePermissions } from '../authorization.js';
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

const CREATE_PROJECT_OPERATION: OperationDef = operationById(OPERATION_ID_CREATE_PROJECT);

interface CreateProjectBody {
  readonly name: string;
  readonly frameworkType: 'javascript' | 'react' | 'vue' | 'other';
  readonly websiteUrl?: string;
  readonly idempotencyKey: string;
}

/**
 * POST /api/platform/v1/organizations/:organizationId/projects — B2 atomic
 * project creation (owner/admin only). CSRF + Origin are enforced by the
 * plugins (registry marks this operation `csrf: true`), so the handler does no
 * manual CSRF work (mirrors handleAcceptInvitation).
 *
 * The data layer creates { project + default `production` environment + default
 * client key (public_identifier + SHA-256 key_digest) + onboarding row } in ONE
 * transaction and never persists or returns the client-key secret. The handler
 * therefore returns only `clientKeyPublicIdentifier` (public, safe in browser
 * code) — never a key secret.
 *
 * Idempotency: same key + same request replays the stored first result; same
 * key + a different request -> 409 idempotency_conflict. The command re-reads
 * the actor's membership inside the transaction so a member demoted between the
 * outer permission check and the write is still rejected (spec §13 fresh
 * re-reads).
 */
export async function handleCreateProject(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(CREATE_PROJECT_OPERATION, {
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
  const input = parsed.data.body as CreateProjectBody;

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

  const digest = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, digest);
  if (probe.outcome === 'replay') {
    const serialized = serializeOutput(CREATE_PROJECT_OPERATION, 200, probe.resultData);
    if (!serialized.ok) {
      await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
      return;
    }
    void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
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

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_CREATE_PROJECT,
      digest,
      execute: async (client) => {
        // Fresh re-read of the actor's membership on the command transaction so
        // a demoted/removed actor cannot create after the outer check passed.
        await requireOrgManagerOnTransaction(client, session.accountId, organizationId);

        const result = await createProject(client, {
          orgId: organizationId,
          name: input.name,
          frameworkType: input.frameworkType,
          ...(input.websiteUrl === undefined ? {} : { websiteUrl: input.websiteUrl }),
          createdBy: session.accountId,
        });
        return {
          projectId: result.projectId,
          clientKeyPublicIdentifier: result.clientKeyPublicIdentifier,
          defaultEnvironment: result.environmentName,
          onboardingStatus: result.onboardingStatus,
          navigationTargets: orgNavigation('organization.project-create', organizationId),
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

  const serialized = serializeOutput(CREATE_PROJECT_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
