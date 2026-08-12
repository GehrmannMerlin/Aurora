import type { Pool, PoolClient } from 'pg';
import { PlatformProjectGovernanceError, toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { isPoolClient, withTransaction } from './transaction.js';
import type { ProjectRole } from './projects.js';

/**
 * C13 effective project access (UX/UI §7.28). The server computes the
 * per-person effective projection once: an org manager (owner/admin) of the
 * project's org inherits `project_admin` capability regardless of any
 * `project_members` row; any other org member resolves their explicit project
 * role. `sources` tells the UI WHY the person has access so it never merges the
 * org member table and the project member table itself.
 */

export interface EffectiveProjectMember {
  readonly accountId: string;
  /** Full email; the HTTP handler masks it before serialization. */
  readonly email: string;
  readonly effectiveRole: ProjectRole;
  readonly sources: readonly ('org_inherited' | 'project_member')[];
  /** Present only when the person holds an explicit project_members row. */
  readonly projectRole?: ProjectRole;
}

export interface ListProjectEffectiveMembersInput {
  readonly orgId: string;
  readonly projectId: string;
}

export type EffectiveMemberSource = 'org_inherited' | 'project_member';

export interface ChangeProjectMemberRoleInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly role: ProjectRole;
  readonly actorId: string;
}

export type ChangeProjectMemberRoleResult =
  | { readonly status: 'success'; readonly accountId: string; readonly role: ProjectRole }
  | { readonly status: 'not_found' };

export interface RemoveProjectMemberInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly actorId: string;
}

export type RemoveProjectMemberResult =
  | {
      readonly status: 'success';
      readonly accountId: string;
      readonly remainingSources: readonly EffectiveMemberSource[];
    }
  | { readonly status: 'not_found' };

interface EffectiveMemberRowShape {
  account_id: string;
  email: string;
  org_role: string;
  project_role: string | null;
}

function toEffectiveMember(row: EffectiveMemberRowShape): EffectiveProjectMember {
  const isOrgManager = row.org_role === 'owner' || row.org_role === 'admin';
  const sources: EffectiveMemberSource[] = [];
  if (isOrgManager) sources.push('org_inherited');
  if (row.project_role !== null) sources.push('project_member');
  return {
    accountId: row.account_id,
    email: row.email,
    effectiveRole: isOrgManager ? 'project_admin' : (row.project_role as ProjectRole),
    sources,
    ...(row.project_role !== null ? { projectRole: row.project_role as ProjectRole } : {}),
  };
}

/** List every person who can access the project (org inheritance + explicit rows). */
export async function listProjectEffectiveMembers(
  pool: Pool | PoolClient,
  input: ListProjectEffectiveMembersInput,
): Promise<EffectiveProjectMember[]> {
  try {
    const result = await pool.query<EffectiveMemberRowShape>(
      `SELECT om.account_id, om.email, om.role AS org_role, pm.role AS project_role
       FROM organization_members om
       LEFT JOIN project_members pm
         ON pm.project_id = $2 AND pm.account_id = om.account_id
       WHERE om.organization_id = $1
         AND (om.role IN ('owner','admin') OR pm.project_id IS NOT NULL)
       ORDER BY om.created_at ASC, om.account_id ASC`,
      [input.orgId, input.projectId],
    );
    return result.rows.map(toEffectiveMember);
  } catch (error) {
    throw toStableError(error);
  }
}

async function runChangeProjectMemberRole(
  client: PoolClient,
  input: ChangeProjectMemberRoleInput,
): Promise<ChangeProjectMemberRoleResult> {
  if (!['project_admin', 'developer', 'read_only'].includes(input.role)) {
    throw new PlatformProjectGovernanceError('invalid_input', 'invalid project role');
  }
  const updated = await client.query<{ account_id: string }>(
    `UPDATE project_members pm
     SET role = $4, updated_at = now()
     FROM projects p
     WHERE pm.project_id = p.project_id
       AND p.organization_id = $1
       AND p.project_id = $2
       AND pm.account_id = $3
     RETURNING pm.account_id`,
    [input.orgId, input.projectId, input.accountId, input.role],
  );
  const row = updated.rows[0];
  if (row === undefined) return { status: 'not_found' };
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.member_role_changed',
    details: { projectId: input.projectId, accountId: input.accountId, role: input.role },
  });
  return { status: 'success', accountId: row.account_id, role: input.role };
}

/** Change an explicit project member role (org-inherited access is untouched). */
export async function changeProjectMemberRole(
  pool: Pool | PoolClient,
  input: ChangeProjectMemberRoleInput,
): Promise<ChangeProjectMemberRoleResult> {
  try {
    return isPoolClient(pool)
      ? await runChangeProjectMemberRole(pool, input)
      : await withTransaction(pool, (client) => runChangeProjectMemberRole(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runRemoveProjectMember(
  client: PoolClient,
  input: RemoveProjectMemberInput,
): Promise<RemoveProjectMemberResult> {
  const deleted = await client.query<{ account_id: string }>(
    `DELETE FROM project_members pm
     USING projects p
     WHERE pm.project_id = p.project_id
       AND p.organization_id = $1
       AND p.project_id = $2
       AND pm.account_id = $3
     RETURNING pm.account_id`,
    [input.orgId, input.projectId, input.accountId],
  );
  const row = deleted.rows[0];
  if (row === undefined) return { status: 'not_found' };
  // Compute the remaining access after the explicit relation is removed: org
  // inheritance (manager) may keep the person effective access to the project.
  const inherited = await client.query<{ org_inherited: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM organization_members om
       WHERE om.organization_id = $1 AND om.account_id = $2 AND om.role IN ('owner','admin')
     ) AS org_inherited`,
    [input.orgId, input.accountId],
  );
  const remainingSources: EffectiveMemberSource[] = inherited.rows[0]?.org_inherited
    ? ['org_inherited']
    : [];
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.member_removed',
    details: { projectId: input.projectId, accountId: input.accountId },
  });
  return { status: 'success', accountId: row.account_id, remainingSources };
}

/** Remove an explicit project membership; org-inherited access (if any) remains. */
export async function removeProjectMember(
  pool: Pool | PoolClient,
  input: RemoveProjectMemberInput,
): Promise<RemoveProjectMemberResult> {
  try {
    return isPoolClient(pool)
      ? await runRemoveProjectMember(pool, input)
      : await withTransaction(pool, (client) => runRemoveProjectMember(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
