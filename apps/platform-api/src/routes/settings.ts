import type { FastifyReply, FastifyRequest } from 'fastify';
import { updateOrganizationTimezone } from '@aurora/platform-organization';
import { OPERATION_ID_UPDATE_TIMEZONE } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { withTransaction } from '../db.js';
import { effectivePermissions } from '../authorization.js';
import {
  requireOrgManager,
  requireOrgManagerOnTransaction,
  requireSession,
  requireUuidParams,
} from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const UPDATE_TIMEZONE_OPERATION: OperationDef = operationById(OPERATION_ID_UPDATE_TIMEZONE);

/** The contract `resourceVersion` is `str(1,64)`; only a canonical non-negative
 *  integer is a valid optimistic-concurrency version. */
const RESOURCE_VERSION_PATTERN = /^\d{1,18}$/;

interface UpdateTimezoneBody {
  readonly timezone: string;
  readonly resourceVersion: string;
}

/**
 * PATCH /api/platform/v1/organizations/:organizationId/settings/timezone — B4
 * org business-timezone update (owner/admin only). Versioned (optimistic
 * concurrency via `resourceVersion`, NOT idempotent): a stale
 * `resourceVersion` maps to 412 `version_conflict`; the server's current
 * settings version is returned in the problem's fieldErrors so the caller can
 * re-confirm. Only an org manager reaches this branch (requireOrgManager), so
 * the current version is never leaked beyond the org. CSRF + Origin are enforced
 * by the plugins (registry marks this operation `csrf: true`).
 */
export async function handleUpdateTimezone(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(UPDATE_TIMEZONE_OPERATION, {
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
  const input = parsed.data.body as UpdateTimezoneBody;

  // The contract `resourceVersion` is `str(1,64)`; only a canonical non-negative
  // integer is a valid optimistic-concurrency version. A non-numeric value
  // (e.g. "abc") must be a structural error, not a silent version_conflict.
  const expectedVersion = Number(input.resourceVersion);
  const versionIsValid =
    RESOURCE_VERSION_PATTERN.test(input.resourceVersion) && Number.isSafeInteger(expectedVersion);
  if (!versionIsValid) {
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
    // Re-read the actor's membership on the same transaction as the update so a
    // demoted/removed manager cannot win the TOCTOU window (spec §13 fresh
    // re-reads; mirrors B2 and the pattern 6C must mirror).
    result = await withTransaction(deps.pool, async (client) => {
      await requireOrgManagerOnTransaction(client, session.accountId, organizationId);
      return updateOrganizationTimezone(client, {
        orgId: organizationId,
        timezone: input.timezone,
        expectedVersion,
        actorId: session.accountId,
      });
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (result.status === 'version_conflict') {
    await sendProblem(
      reply,
      requestId,
      412,
      'version_conflict',
      'The organization settings version is stale.',
      {
        fieldErrors: [
          {
            field: 'resourceVersion',
            reason: `Current version is ${result.currentSettingsVersion}.`,
          },
        ],
      },
    );
    return;
  }
  if (result.status === 'not_found') {
    await sendProblem(reply, requestId, 404, 'not_found', 'The organization was not found.');
    return;
  }

  const data = {
    organizationId: result.organizationId,
    timezone: result.timezone,
    resourceVersion: String(result.settingsVersion),
  };

  const serialized = serializeOutput(UPDATE_TIMEZONE_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
