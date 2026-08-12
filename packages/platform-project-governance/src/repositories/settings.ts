import type { Pool, PoolClient } from 'pg';
import { PlatformProjectGovernanceError, isUniqueViolation, toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { isoTimestamp, isoVersionKey } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';
import type { ProjectStatus } from './projects.js';

/**
 * C15 project settings + environment directory (UX/UI §7.30 / PRD §13). Only
 * the project name and the optional production website URL are editable;
 * framework/ingest type is read-only. Environments are immutable after creation.
 */

export interface UpdateProjectSettingsInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly name: string;
  readonly websiteUrl?: string | null;
  readonly expectedVersion: string;
  readonly actorId: string;
}

export type UpdateProjectSettingsResult =
  | {
      readonly status: 'success';
      readonly projectId: string;
      readonly name: string;
      readonly websiteUrl: string | null;
      readonly resourceVersion: string;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'version_conflict'; readonly currentResourceVersion: string }
  | { readonly status: 'state_machine_conflict'; readonly currentStatus: ProjectStatus };

export interface ProjectEnvironmentRow {
  readonly environmentId: string;
  readonly projectId: string;
  readonly name: string;
  readonly isDefault: string;
  readonly createdAt: string;
}

export interface CreateProjectEnvironmentInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly name: string;
  readonly actorId: string;
}

export type CreateProjectEnvironmentResult =
  | { readonly status: 'success'; readonly environmentId: string; readonly name: string }
  | { readonly status: 'not_found' }
  | { readonly status: 'duplicate' };

interface ProjectLockShape {
  status: ProjectStatus;
  updated_at: Date | string;
}

async function runUpdateProjectSettings(
  client: PoolClient,
  input: UpdateProjectSettingsInput,
): Promise<UpdateProjectSettingsResult> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 50) {
    throw new PlatformProjectGovernanceError(
      'invalid_input',
      'project name must be 2-50 characters after trimming',
    );
  }
  const websiteUrl =
    input.websiteUrl === undefined || input.websiteUrl === null || input.websiteUrl.trim() === ''
      ? null
      : input.websiteUrl.trim();

  const locked = await client.query<ProjectLockShape>(
    `SELECT status, updated_at FROM projects
     WHERE project_id = $1 AND organization_id = $2 FOR UPDATE`,
    [input.projectId, input.orgId],
  );
  const row = locked.rows[0];
  if (row === undefined) return { status: 'not_found' };
  if (isoVersionKey(row.updated_at) !== isoVersionKey(input.expectedVersion)) {
    return { status: 'version_conflict', currentResourceVersion: isoVersionKey(row.updated_at) };
  }
  if (row.status !== 'active') {
    return { status: 'state_machine_conflict', currentStatus: row.status };
  }

  const updated = await client.query<{ updated_at: Date }>(
    `UPDATE projects SET name = $1, website_url = $2, updated_at = now()
     WHERE project_id = $3
     RETURNING updated_at`,
    [name, websiteUrl, input.projectId],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow === undefined) throw new Error('unreachable: project lock row disappeared');

  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.settings_updated',
    details: { projectId: input.projectId },
  });

  return {
    status: 'success',
    projectId: input.projectId,
    name,
    websiteUrl,
    resourceVersion: isoVersionKey(updatedRow.updated_at),
  };
}

/** Update editable project settings (name + optional website URL) with optimistic concurrency. */
export async function updateProjectSettings(
  pool: Pool | PoolClient,
  input: UpdateProjectSettingsInput,
): Promise<UpdateProjectSettingsResult> {
  try {
    return isPoolClient(pool)
      ? await runUpdateProjectSettings(pool, input)
      : await withTransaction(pool, (client) => runUpdateProjectSettings(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

/** List the project environment directory (default production first). */
export async function listProjectEnvironments(
  pool: Pool | PoolClient,
  input: { readonly orgId: string; readonly projectId: string },
): Promise<ProjectEnvironmentRow[]> {
  try {
    const result = await pool.query<{
      environment_id: string;
      project_id: string;
      name: string;
      is_default: string;
      created_at: Date | string;
    }>(
      `SELECT pe.environment_id, pe.project_id, pe.name, pe.is_default, pe.created_at
       FROM project_environments pe
       JOIN projects p ON p.project_id = pe.project_id
       WHERE p.organization_id = $1 AND pe.project_id = $2
       ORDER BY pe.is_default DESC, pe.created_at ASC, pe.environment_id ASC`,
      [input.orgId, input.projectId],
    );
    return result.rows.map((row) => ({
      environmentId: row.environment_id,
      projectId: row.project_id,
      name: row.name,
      isDefault: row.is_default,
      createdAt: isoTimestamp(row.created_at),
    }));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runCreateProjectEnvironment(
  client: PoolClient,
  input: CreateProjectEnvironmentInput,
): Promise<CreateProjectEnvironmentResult> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 32) {
    throw new PlatformProjectGovernanceError(
      'invalid_input',
      'environment name must be 1-32 characters after trimming',
    );
  }
  const project = await client.query(
    `SELECT 1 FROM projects WHERE project_id = $1 AND organization_id = $2`,
    [input.projectId, input.orgId],
  );
  if (project.rows.length === 0) return { status: 'not_found' };
  try {
    const inserted = await client.query<{ environment_id: string }>(
      `INSERT INTO project_environments (project_id, name)
       VALUES ($1, $2)
       RETURNING environment_id`,
      [input.projectId, name],
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new PlatformProjectGovernanceError('statement_failed', 'environment insert returned no row');
    }
    await insertAuditEvent(client, {
      organizationId: input.orgId,
      actorAccountId: input.actorId,
      action: 'project.environment_created',
      details: { projectId: input.projectId, environmentName: name },
    });
    return { status: 'success', environmentId: row.environment_id, name };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'duplicate' };
    throw error;
  }
}

/** Create an environment; the name is immutable after creation (UX/UI §7.30). */
export async function createProjectEnvironment(
  pool: Pool | PoolClient,
  input: CreateProjectEnvironmentInput,
): Promise<CreateProjectEnvironmentResult> {
  try {
    return isPoolClient(pool)
      ? await runCreateProjectEnvironment(pool, input)
      : await withTransaction(pool, (client) => runCreateProjectEnvironment(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
