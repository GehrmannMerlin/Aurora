import type { FastifyReply, FastifyRequest } from 'fastify';
import { listProjects, type ProjectRow } from '@aurora/platform-project-governance';
import { OPERATION_ID_LIST_PROJECTS } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { effectivePermissions, toContractAllowedActions } from '../authorization.js';
import { orgNavigation, requireSession, requireUuidParams } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LIST_PROJECTS_OPERATION: OperationDef = operationById(OPERATION_ID_LIST_PROJECTS);

/**
 * GET /api/platform/v1/organizations/:organizationId/projects — B1 workspace
 * list (spec §6). Session + membership-scoped project projection: a non-member
 * receives a closed 403 with no org-existence leak; an org member sees the
 * projects the data layer permission-filters (owner/admin see all org projects,
 * any other member sees only assigned projects). `deleting` is a transient
 * cleanup state that is never exposed through the contract (the
 * `projectSummary` status/lifecycle enum is `active`/`archived`/`trash` only),
 * so it is dropped from the projection.
 */
export async function handleListProjects(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(LIST_PROJECTS_OPERATION, { params: request.params });
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
  if (permissions.orgRole === null) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'You do not have permission to access this organization.',
    );
    return;
  }

  let projects: ProjectRow[];
  try {
    projects = await listProjects(deps.pool, {
      orgId: organizationId,
      accountId: session.accountId,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  const data = {
    projects: projects
      .filter((project) => project.status !== 'deleting')
      .map((project) => ({
        projectId: project.projectId,
        name: project.name,
        frameworkType: project.frameworkType,
        status: project.status,
        lifecycle: project.status,
      })),
    allowedActions: toContractAllowedActions(permissions),
    navigationTargets: orgNavigation('workspace.home', organizationId),
  };

  const serialized = serializeOutput(LIST_PROJECTS_OPERATION, 200, data);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
