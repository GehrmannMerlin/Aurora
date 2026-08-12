import type { Pool, PoolClient } from 'pg';
import {
  PlatformPolicyError,
  isPostgresCheckViolation,
  toStableError,
} from '../errors.js';
import { requireActorAccountId, requireExpectedVersion, requireResourceLimit } from '../guards.js';
import type { ProjectLimit, StoredPolicySource } from '../policy-types.js';

/**
 * @aurora/platform-policy — project resource limit repository (PLT-10b,
 * ADR-035). One row per project at most, carrying ONLY `resource_limit` (the
 * remaining protective fields inherit the organization effective policy). No
 * row means the project inherits. `expectedVersion: 0` with no row → INSERT
 * (version 1); `> 0` with a row → optimistic UPDATE; "clear" deletes the row.
 */

export type SetProjectLimitResult =
  | { readonly status: 'set'; readonly version: number }
  | { readonly status: 'version_conflict' }
  | { readonly status: 'project_not_found' }
  | { readonly status: 'temporarily_unavailable' };

export type ClearProjectLimitResult =
  | { readonly status: 'cleared' }
  | { readonly status: 'version_conflict' }
  | { readonly status: 'temporarily_unavailable' };

export interface SetProjectLimitInput {
  readonly projectId: string;
  readonly resourceLimit: number;
  readonly expectedVersion: number;
  readonly actorAccountId: string;
}

interface ProjectPolicyLimitRow {
  project_id: string;
  resource_limit: string;
  policy_source: StoredPolicySource;
  version: number;
  updated_by: string | null;
  updated_at: Date;
}

const LIMIT_COLUMNS = `project_id, resource_limit, policy_source, version, updated_by, updated_at`;

function toProjectLimit(row: ProjectPolicyLimitRow): ProjectLimit {
  return {
    projectId: row.project_id,
    resourceLimit: Number(row.resource_limit),
    policySource: row.policy_source,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    ...(row.updated_by === null ? {} : { updatedBy: row.updated_by }),
  };
}

/** Read the project's resource limit row, or `null` when it inherits. */
export async function getProjectLimit(
  pool: Pool | PoolClient,
  input: { readonly projectId: string },
): Promise<ProjectLimit | null> {
  try {
    const result = await pool.query<ProjectPolicyLimitRow>(
      `SELECT ${LIMIT_COLUMNS}
       FROM project_policy_limits
       WHERE project_id = $1`,
      [input.projectId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toProjectLimit(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Save the project's resource limit. Existence checks first: a missing project
 * → `project_not_found`; a missing actor → `temporarily_unavailable` (details
 * never leaked). `expectedVersion: 0` with no row → INSERT (version 1);
 * `> 0` with a row → optimistic UPDATE; a stale version → `version_conflict`.
 * A DB-enforced `resource_limit > 0` CHECK violation is surfaced as
 * `invalid_input / invalid_resource_limit`.
 */
export async function setProjectLimit(
  pool: Pool | PoolClient,
  input: SetProjectLimitInput,
): Promise<SetProjectLimitResult> {
  try {
    const resourceLimit = requireResourceLimit(input.resourceLimit);
    const actorAccountId = requireActorAccountId(input.actorAccountId);
    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    const projectId = input.projectId.trim();

    const project = await pool.query('SELECT 1 FROM projects WHERE project_id = $1', [projectId]);
    if (project.rows.length === 0) return { status: 'project_not_found' };

    const actor = await pool.query('SELECT 1 FROM accounts WHERE account_id = $1', [
      actorAccountId,
    ]);
    if (actor.rows.length === 0) return { status: 'temporarily_unavailable' };

    const existing = await pool.query<{ version: number }>(
      'SELECT version FROM project_policy_limits WHERE project_id = $1',
      [projectId],
    );
    const current = existing.rows[0];

    if (current === undefined) {
      if (expectedVersion !== 0) return { status: 'version_conflict' };
      const inserted = await pool.query<{ version: number }>(
        `INSERT INTO project_policy_limits (project_id, resource_limit, policy_source, updated_by)
         VALUES ($1, $2, 'platform_admin', $3)
         RETURNING version`,
        [projectId, resourceLimit, actorAccountId],
      );
      const row = inserted.rows[0];
      return { status: 'set', version: row?.version ?? 1 };
    }

    if (current.version !== expectedVersion) return { status: 'version_conflict' };

    const updated = await pool.query<{ version: number }>(
      `UPDATE project_policy_limits
       SET resource_limit = $2, policy_source = 'platform_admin', updated_by = $3, updated_at = now(),
           version = version + 1
       WHERE project_id = $1 AND version = $4
       RETURNING version`,
      [projectId, resourceLimit, actorAccountId, expectedVersion],
    );
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) return { status: 'version_conflict' };
    return { status: 'set', version: updatedRow.version };
  } catch (error) {
    if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') throw error;
    if (isPostgresCheckViolation(error)) {
      throw new PlatformPolicyError('invalid_input', 'invalid_resource_limit');
    }
    return { status: 'temporarily_unavailable' };
  }
}

/**
 * Delete the project's resource limit ("clear the project override"). No row →
 * `cleared` (idempotent success); a stale version → `version_conflict`. The
 * actor is part of the command interface for the handler-layer audit write and
 * is not written to the row, so no actor existence check is performed here.
 */
export async function clearProjectLimit(
  pool: Pool | PoolClient,
  input: { readonly projectId: string; readonly expectedVersion: number; readonly actorAccountId: string },
): Promise<ClearProjectLimitResult> {
  try {
    requireActorAccountId(input.actorAccountId);
    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    const projectId = input.projectId.trim();

    const existing = await pool.query<{ version: number }>(
      'SELECT version FROM project_policy_limits WHERE project_id = $1',
      [projectId],
    );
    const current = existing.rows[0];
    if (current === undefined) return { status: 'cleared' };
    if (current.version !== expectedVersion) return { status: 'version_conflict' };

    const deleted = await pool.query<{ project_id: string }>(
      `DELETE FROM project_policy_limits
       WHERE project_id = $1 AND version = $2
       RETURNING project_id`,
      [projectId, expectedVersion],
    );
    if (deleted.rows.length === 0) return { status: 'version_conflict' };
    return { status: 'cleared' };
  } catch (error) {
    if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') throw error;
    return { status: 'temporarily_unavailable' };
  }
}
