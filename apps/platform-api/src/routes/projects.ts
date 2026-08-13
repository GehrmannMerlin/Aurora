import type { FastifyReply, FastifyRequest } from 'fastify';
import { createIngestionClientCredential } from '@aurora/ingestion-credentials';
import { createProject } from '@aurora/platform-project-governance';
import { insertAuditEvent } from '@aurora/platform-identity';
import { OPERATION_ID_CREATE_PROJECT } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError, ServiceError } from '../service-error.js';
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
const SECRET_LOST_PLACEHOLDER = 'secret-not-recoverable-000000000000';

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
 * The command creates { project + default `production` environment + browser
 * ingestion credential + onboarding row + audit } in ONE transaction. The
 * complete browser-safe ingestion key is delivered once in the first response;
 * only its digest is persisted. Idempotent replay returns a fixed recovery
 * placeholder because plaintext is intentionally unrecoverable.
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
  const firstRunClientKey: { value: string | null } = { value: null };
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
        const origins = [...deps.config.appOrigins];
        if (input.websiteUrl !== undefined) {
          try {
            const parsedUrl = new URL(input.websiteUrl);
            if (
              (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') &&
              !origins.includes(parsedUrl.origin)
            ) {
              origins.push(parsedUrl.origin);
            }
          } catch {
            // The public contract already bounds the optional string. An
            // unusable website URL simply contributes no credential Origin.
          }
        }
        const credential = await createIngestionClientCredential(client, {
          projectId: result.projectId,
          origins,
          environments: ['production'],
          // The first-run acceptance and server-side SDKs may send without an
          // Origin header. Browser requests remain restricted to websiteUrl.
          allowNonBrowser: true,
          expiresAt: null,
        });
        if (credential.status !== 'success') {
          if (credential.status === 'invalid_input') {
            throw new ServiceError(422, 'field_validation', 'Client key input is invalid.');
          }
          throw new ServiceError(503, 'authority_unavailable', 'Client key store unavailable.');
        }
        firstRunClientKey.value = credential.clientKey;
        await insertAuditEvent(client, {
          organizationId,
          actorAccountId: session.accountId,
          action: 'client_key.created',
          details: { projectId: result.projectId, keyId: credential.metadata.keyId },
        });
        return {
          projectId: result.projectId,
          clientKeyPublicIdentifier: result.clientKeyPublicIdentifier,
          clientKey: SECRET_LOST_PLACEHOLDER,
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

  const stored = idempotency.resultData as Record<string, unknown>;
  const responseData =
    idempotency.outcome === 'succeeded' && firstRunClientKey.value !== null
      ? { ...stored, clientKey: firstRunClientKey.value }
      : stored;
  const serialized = serializeOutput(CREATE_PROJECT_OPERATION, 200, responseData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
