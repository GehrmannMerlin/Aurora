import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAccountById } from '@aurora/platform-identity';
import { listAccountOrganizations } from '@aurora/platform-organization';
import { listProjects } from '@aurora/platform-project-governance';
import { OPERATION_ID_NAVIGATION } from '@aurora/platform-contract';
import { serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { sendMappedError } from '../service-error.js';
import { requireSession } from './_shared.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const NAVIGATION_OPERATION: OperationDef = operationById(OPERATION_ID_NAVIGATION);

const workspaceTarget = {
  routeId: 'workspace.home' as const,
  pathParams: {},
  query: {},
};

/**
 * GET /api/platform/v1/navigation/context — authorized account workspace,
 * organization and project navigation. A sole personal workspace is selected
 * automatically; multi-workspace accounts keep every authorized organization
 * available to the console switcher. No organization/project is fabricated.
 */
export async function handleGetNavigationContext(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  try {
    const [account, memberships] = await Promise.all([
      getAccountById(deps.pool, session.accountId),
      listAccountOrganizations(deps.pool, session.accountId),
    ]);
    if (account === null) {
      await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
        recoveryTarget: 'auth.login',
      });
      return;
    }

    const organizations = await Promise.all(
      memberships.map(async (membership) => {
        const projects = await listProjects(deps.pool, {
          orgId: membership.organizationId,
          accountId: session.accountId,
        });
        return {
          organizationId: membership.organizationId,
          name: membership.name,
          projects: projects
            .filter((project) => project.status === 'active' || project.status === 'archived')
            .map((project) => ({
              projectId: project.projectId,
              name: project.name,
              lifecycle: project.status as 'active' | 'archived',
              entry: {
                routeId: 'project.overview' as const,
                pathParams: {
                  organizationId: membership.organizationId,
                  projectId: project.projectId,
                },
                query: {},
              },
            })),
          entry: {
            routeId: 'workspace.home' as const,
            pathParams: {},
            query: { organizationId: membership.organizationId },
          },
        };
      }),
    );

    const firstOrganization = organizations[0];
    const defaultTarget = firstOrganization?.entry ?? workspaceTarget;
    const body = {
      account: {
        accountId: account.accountId,
        email: account.email,
        verified: account.verifiedAt !== null,
      },
      workspace: [
        workspaceTarget,
        { routeId: 'account.notifications' as const, pathParams: {}, query: {} },
        { routeId: 'account.security' as const, pathParams: {}, query: {} },
      ],
      organizations,
      currentScope:
        firstOrganization === undefined
          ? ({ type: 'workspace', lifecycle: 'active' } as const)
          : ({
              type: 'organization',
              id: firstOrganization.organizationId,
              lifecycle: 'active',
            } as const),
      defaultTarget,
      safeExitTarget: workspaceTarget,
      unreadCount: { status: 'unavailable' as const },
    };

    const serialized = serializeOutput(NAVIGATION_OPERATION, 200, body);
    if (!serialized.ok) {
      await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
      return;
    }
    void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }
}
