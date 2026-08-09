import type { Pool, PoolClient } from 'pg';
import { PlatformProjectGovernanceError, isUniqueViolation, toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { createDefaultClientKey } from './client-keys.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

export type ProjectStatus = 'active' | 'archived' | 'trash' | 'deleting';
export type FrameworkType = 'javascript' | 'react' | 'vue' | 'other';
export type ProjectRole = 'project_admin' | 'developer' | 'read_only';

const FRAMEWORK_TYPES: readonly FrameworkType[] = ['javascript', 'react', 'vue', 'other'];
const PROJECT_ROLES: readonly ProjectRole[] = ['project_admin', 'developer', 'read_only'];

/** camelCase projection of a projects row (spec §4.1). */
export interface ProjectRow {
  readonly projectId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly frameworkType: FrameworkType;
  readonly websiteUrl: string | null;
  readonly status: ProjectStatus;
  readonly createdBy: string;
  readonly archivedAt: string | null;
  readonly trashedAt: string | null;
  readonly recoverableUntil: string | null;
  readonly deletionStartedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly orgId: string;
  readonly name: string;
  readonly frameworkType: FrameworkType;
  readonly websiteUrl?: string | null;
  readonly createdBy: string;
}

export interface CreateProjectResult {
  readonly status: 'success';
  readonly projectId: string;
  readonly clientKeyId: string;
  /** Public client-key identifier `aurora_key_<...>`; safe to embed in browser code. */
  readonly clientKeyPublicIdentifier: string;
  readonly environmentId: string;
  readonly environmentName: 'production';
  readonly onboardingStatus: 'not_started';
}

export interface ListProjectsInput {
  readonly orgId: string;
  readonly accountId: string;
}

export interface GetProjectInput {
  readonly orgId: string;
  readonly projectId: string;
}

export interface UpdateProjectStatusInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export type UpdateProjectStatusResult =
  | {
      readonly status: 'success';
      readonly projectId: string;
      readonly fromStatus: ProjectStatus;
      readonly toStatus: 'archived';
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'state_machine_conflict'; readonly currentStatus: ProjectStatus };

export interface InsertProjectMemberInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly accountId: string;
  readonly role: ProjectRole;
}

export type InsertProjectMemberResult =
  | {
      readonly status: 'success';
      readonly projectId: string;
      readonly accountId: string;
      readonly role: ProjectRole;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_member' };

export interface ProjectRowShape {
  project_id: string;
  organization_id: string;
  name: string;
  framework_type: FrameworkType;
  website_url: string | null;
  status: ProjectStatus;
  created_by: string;
  archived_at: Date | string | null;
  trashed_at: Date | string | null;
  recoverable_until: Date | string | null;
  deletion_started_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function toProjectRow(row: ProjectRowShape): ProjectRow {
  return {
    projectId: row.project_id,
    organizationId: row.organization_id,
    name: row.name,
    frameworkType: row.framework_type,
    websiteUrl: row.website_url,
    status: row.status,
    createdBy: row.created_by,
    archivedAt: isoTimestamp(row.archived_at),
    trashedAt: isoTimestamp(row.trashed_at),
    recoverableUntil: isoTimestamp(row.recoverable_until),
    deletionStartedAt: isoTimestamp(row.deletion_started_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

export const PROJECT_COLUMNS = `
  project_id, organization_id, name, framework_type, website_url, status,
  created_by, archived_at, trashed_at, recoverable_until, deletion_started_at,
  created_at, updated_at
`;

async function runCreateProject(
  client: PoolClient,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 50) {
    throw new PlatformProjectGovernanceError(
      'invalid_input',
      'project name must be 2-50 characters after trimming',
    );
  }
  if (!FRAMEWORK_TYPES.includes(input.frameworkType)) {
    throw new PlatformProjectGovernanceError('invalid_input', 'invalid framework_type');
  }
  const websiteUrl =
    input.websiteUrl === undefined || input.websiteUrl === null || input.websiteUrl.trim() === ''
      ? null
      : input.websiteUrl.trim();

  const inserted = await client.query<{ project_id: string }>(
    `INSERT INTO projects (organization_id, name, framework_type, website_url, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING project_id`,
    [input.orgId, name, input.frameworkType, websiteUrl, input.createdBy],
  );
  const projectRow = inserted.rows[0];
  if (projectRow === undefined) {
    throw new PlatformProjectGovernanceError('statement_failed', 'project insert returned no row');
  }
  const projectId = projectRow.project_id;

  // Default `production` environment (is_default = true).
  const environment = await client.query<{ environment_id: string }>(
    `INSERT INTO project_environments (project_id, name, is_default)
     VALUES ($1, 'production', true)
     RETURNING environment_id`,
    [projectId],
  );
  const environmentRow = environment.rows[0];
  if (environmentRow === undefined) {
    throw new PlatformProjectGovernanceError(
      'statement_failed',
      'environment insert returned no row',
    );
  }

  // Default client key: public_identifier + SHA-256 key_digest only (the secret
  // is generated once and never persisted nor returned by this package).
  const clientKey = await createDefaultClientKey(client, { projectId });

  // Onboarding row: not_started / current_step 0.
  await client.query(
    `INSERT INTO project_onboarding (project_id, status, current_step)
     VALUES ($1, 'not_started', 0)`,
    [projectId],
  );

  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.createdBy,
    action: 'project.created',
    details: { projectId, projectName: name, frameworkType: input.frameworkType },
  });

  return {
    status: 'success',
    projectId,
    clientKeyId: clientKey.clientKeyId,
    clientKeyPublicIdentifier: clientKey.publicIdentifier,
    environmentId: environmentRow.environment_id,
    environmentName: 'production',
    onboardingStatus: 'not_started',
  };
}

/**
 * Create a project ATOMICALLY: the project row + default `production`
 * environment + default client key (public_identifier + key_digest) + onboarding
 * row are inserted in a single transaction with the `project.created` audit row.
 * Any failure rolls the whole transaction back — no partial rows are ever
 * visible. The client-key secret is generated once, reduced to its SHA-256
 * digest, and never persisted or returned. Transactional.
 */
export async function createProject(
  pool: Pool | PoolClient,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  try {
    return isPoolClient(pool)
      ? await runCreateProject(pool, input)
      : await withTransaction(pool, (client) => runCreateProject(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * List the projects an account can see in an organization (spec §6 effective
 * permission projection). Owner/admin org members see all org projects;
 * any other org member sees only projects where they hold a `project_members`
 * row (project_admin/developer/read_only).
 */
export async function listProjects(
  pool: Pool | PoolClient,
  input: ListProjectsInput,
): Promise<ProjectRow[]> {
  try {
    const result = await pool.query<ProjectRowShape>(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects p
       WHERE p.organization_id = $1
         AND (
           EXISTS (
             SELECT 1 FROM organization_members om
             WHERE om.organization_id = p.organization_id
               AND om.account_id = $2
               AND om.role IN ('owner','admin')
           )
           OR EXISTS (
             SELECT 1 FROM project_members pm
             WHERE pm.project_id = p.project_id AND pm.account_id = $2
           )
         )
       ORDER BY p.created_at DESC, p.project_id ASC`,
      [input.orgId, input.accountId],
    );
    return result.rows.map(toProjectRow);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Get a single project by primary key (scoped to its organization); null when absent. */
export async function getProjectById(
  pool: Pool | PoolClient,
  input: GetProjectInput,
): Promise<ProjectRow | null> {
  try {
    const result = await pool.query<ProjectRowShape>(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects
       WHERE project_id = $1 AND organization_id = $2`,
      [input.projectId, input.orgId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toProjectRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

async function runUpdateProjectStatus(
  client: PoolClient,
  input: UpdateProjectStatusInput,
): Promise<UpdateProjectStatusResult> {
  const locked = await client.query<{ status: ProjectStatus }>(
    `SELECT status FROM projects WHERE project_id = $1 AND organization_id = $2 FOR UPDATE`,
    [input.projectId, input.orgId],
  );
  const row = locked.rows[0];
  if (row === undefined) return { status: 'not_found' };
  if (row.status === 'archived') {
    return {
      status: 'success',
      projectId: input.projectId,
      fromStatus: 'archived',
      toStatus: 'archived',
    };
  }
  if (row.status !== 'active') {
    return { status: 'state_machine_conflict', currentStatus: row.status };
  }
  await client.query(
    `UPDATE projects SET status = 'archived', archived_at = now(), updated_at = now()
     WHERE project_id = $1`,
    [input.projectId],
  );
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.archived',
    details: {
      projectId: input.projectId,
      fromStatus: 'active',
      toStatus: 'archived',
    },
  });
  return {
    status: 'success',
    projectId: input.projectId,
    fromStatus: 'active',
    toStatus: 'archived',
  };
}

/**
 * Archive a project (active → archived), writing the `project.archived` audit
 * row in the same transaction. Idempotent for an already-archived project;
 * trash/deleting projects are rejected (`state_machine_conflict`). Transactional.
 */
export async function updateProjectStatus(
  pool: Pool | PoolClient,
  input: UpdateProjectStatusInput,
): Promise<UpdateProjectStatusResult> {
  try {
    return isPoolClient(pool)
      ? await runUpdateProjectStatus(pool, input)
      : await withTransaction(pool, (client) => runUpdateProjectStatus(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runInsertProjectMember(
  client: PoolClient,
  input: InsertProjectMemberInput,
): Promise<InsertProjectMemberResult> {
  // Defense-in-depth: the public input type narrows role to the three project
  // roles, but a caller that bypasses the type must still be rejected.
  if (!PROJECT_ROLES.includes(input.role)) {
    throw new PlatformProjectGovernanceError('invalid_input', 'invalid project role');
  }
  const project = await client.query(
    `SELECT 1 FROM projects WHERE project_id = $1 AND organization_id = $2`,
    [input.projectId, input.orgId],
  );
  if (project.rows.length === 0) return { status: 'not_found' };
  // Only current organization members can be granted a project role.
  const member = await client.query(
    `SELECT 1 FROM organization_members WHERE organization_id = $1 AND account_id = $2`,
    [input.orgId, input.accountId],
  );
  if (member.rows.length === 0) return { status: 'not_found' };
  try {
    await client.query(
      `INSERT INTO project_members (project_id, account_id, role) VALUES ($1, $2, $3)`,
      [input.projectId, input.accountId, input.role],
    );
    return {
      status: 'success',
      projectId: input.projectId,
      accountId: input.accountId,
      role: input.role,
    };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'already_member' };
    throw error;
  }
}

/**
 * Grant a project role to a current organization member. `project_members`
 * keeps the PLT-03 composite PK (project_id, account_id) and `project_id` stays
 * a plain uuid with no FK (PLT-03 §4.8) — this repository does not add one.
 * Validates the role and that the account is a current org member. Transactional.
 */
export async function insertProjectMember(
  pool: Pool | PoolClient,
  input: InsertProjectMemberInput,
): Promise<InsertProjectMemberResult> {
  try {
    return isPoolClient(pool)
      ? await runInsertProjectMember(pool, input)
      : await withTransaction(pool, (client) => runInsertProjectMember(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
