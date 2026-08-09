import type { Pool, PoolClient } from 'pg';
import { toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import {
  PROJECT_COLUMNS,
  toProjectRow,
  type ProjectRow,
  type ProjectRowShape,
  type ProjectStatus,
} from './projects.js';
import { isoTimestamp, isoVersionKey } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

/** Default B8 recovery window: a project is recoverable for 7 days after trash. */
const RECOVERABLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface TrashProjectInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export type TrashProjectResult =
  | {
      readonly status: 'success';
      readonly projectId: string;
      readonly fromStatus: ProjectStatus;
      readonly trashedAt: string;
      readonly recoverableUntil: string;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'state_machine_conflict'; readonly currentStatus: ProjectStatus };

export interface RestoreProjectInput {
  readonly orgId: string;
  readonly projectId: string;
  /** Optimistic concurrency: the client's last-known project updatedAt (ISO). */
  readonly resourceVersion: string;
  readonly actorId: string;
}

export type RestoreProjectResult =
  | { readonly status: 'success'; readonly projectId: string; readonly projectStatus: 'active' }
  | { readonly status: 'not_found' }
  | { readonly status: 'version_conflict'; readonly currentResourceVersion: string }
  | {
      readonly status: 'state_machine_conflict';
      readonly currentStatus: ProjectStatus;
      readonly recoverableUntil: string | null;
    };

interface ProjectLockShape {
  status: ProjectStatus;
  updated_at: Date | string;
  recoverable_until: Date | string | null;
}

async function runTrashProject(
  client: PoolClient,
  input: TrashProjectInput,
): Promise<TrashProjectResult> {
  const locked = await client.query<{ status: ProjectStatus }>(
    `SELECT status FROM projects WHERE project_id = $1 AND organization_id = $2 FOR UPDATE`,
    [input.projectId, input.orgId],
  );
  const row = locked.rows[0];
  if (row === undefined) return { status: 'not_found' };
  if (row.status !== 'active' && row.status !== 'archived') {
    return { status: 'state_machine_conflict', currentStatus: row.status };
  }
  const updated = await client.query<{ trashed_at: Date; recoverable_until: Date }>(
    `UPDATE projects
     SET status = 'trash',
         trashed_at = now(),
         recoverable_until = now() + $3::interval,
         archived_at = NULL,
         updated_at = now()
     WHERE project_id = $1 AND organization_id = $2
     RETURNING trashed_at, recoverable_until`,
    [input.projectId, input.orgId, `${String(RECOVERABLE_WINDOW_MS)} milliseconds`],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow === undefined) {
    throw new Error('unreachable: project lock row disappeared');
  }
  // Mark every enabled client key of the trashed project disabled. Restore does
  // NOT re-enable them (G10 approved B8 rule 4).
  await client.query(
    `UPDATE client_keys SET enabled = false, updated_at = now()
     WHERE project_id = $1 AND enabled = true`,
    [input.projectId],
  );
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.trashed',
    details: { projectId: input.projectId, fromStatus: row.status },
  });
  return {
    status: 'success',
    projectId: input.projectId,
    fromStatus: row.status,
    trashedAt: updatedRow.trashed_at.toISOString(),
    recoverableUntil: updatedRow.recoverable_until.toISOString(),
  };
}

/**
 * Move an active/archived project into the trash (B8): sets status='trash',
 * records trashed_at + a 7-day recoverable_until window, disables every enabled
 * client key, and writes the `project.trashed` audit row — all in one
 * transaction. Transactional.
 */
export async function trashProject(
  pool: Pool | PoolClient,
  input: TrashProjectInput,
): Promise<TrashProjectResult> {
  try {
    return isPoolClient(pool)
      ? await runTrashProject(pool, input)
      : await withTransaction(pool, (client) => runTrashProject(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

/** List the trashed projects of an organization (newest first). */
export async function listTrash(pool: Pool | PoolClient, orgId: string): Promise<ProjectRow[]> {
  try {
    const result = await pool.query<ProjectRowShape>(
      `SELECT ${PROJECT_COLUMNS}
       FROM projects
       WHERE organization_id = $1 AND status = 'trash'
       ORDER BY trashed_at DESC, project_id ASC`,
      [orgId],
    );
    return result.rows.map(toProjectRow);
  } catch (error) {
    throw toStableError(error);
  }
}

async function runRestoreProject(
  client: PoolClient,
  input: RestoreProjectInput,
): Promise<RestoreProjectResult> {
  const locked = await client.query<ProjectLockShape>(
    `SELECT status, updated_at, recoverable_until
     FROM projects
     WHERE project_id = $1 AND organization_id = $2
     FOR UPDATE`,
    [input.projectId, input.orgId],
  );
  const row = locked.rows[0];
  if (row === undefined) return { status: 'not_found' };

  if (isoVersionKey(row.updated_at) !== isoVersionKey(input.resourceVersion)) {
    return { status: 'version_conflict', currentResourceVersion: isoVersionKey(row.updated_at) };
  }

  // Only `trash` within the recovery window can be restored. `deleting` /
  // `deleted` (row gone) and any expired window are rejected and carry the
  // current authoritative status for the service to map to 409 state_machine_conflict.
  if (row.status !== 'trash') {
    return {
      status: 'state_machine_conflict',
      currentStatus: row.status,
      recoverableUntil: isoTimestamp(row.recoverable_until),
    };
  }
  const recoverableUntilMs =
    row.recoverable_until === null
      ? null
      : (row.recoverable_until instanceof Date
          ? row.recoverable_until
          : new Date(row.recoverable_until)
        ).getTime();
  if (recoverableUntilMs === null || recoverableUntilMs <= Date.now()) {
    return {
      status: 'state_machine_conflict',
      currentStatus: 'trash',
      recoverableUntil: isoTimestamp(row.recoverable_until),
    };
  }

  // G10 approved B8 rule 5: membership/roles are recomputed against the CURRENT
  // org state, never restored from a historical permission snapshot. Drop
  // project grants for accounts that are no longer organization members; the
  // grants of current members are preserved. Alerts are not auto-restarted
  // (rule 2) and revoked private tokens are not restored (rule 3) — this package
  // owns neither surface, so there is nothing to touch here.
  await client.query(
    `DELETE FROM project_members
     WHERE project_id = $1
       AND account_id NOT IN (
         SELECT account_id FROM organization_members WHERE organization_id = $2
       )`,
    [input.projectId, input.orgId],
  );

  await client.query(
    `UPDATE projects
     SET status = 'active',
         archived_at = NULL,
         trashed_at = NULL,
         recoverable_until = NULL,
         deletion_started_at = NULL,
         updated_at = now()
     WHERE project_id = $1`,
    [input.projectId],
  );

  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.restored',
    details: { projectId: input.projectId },
  });

  return { status: 'success', projectId: input.projectId, projectStatus: 'active' };
}

/**
 * Restore a trashed project (trash → active), implementing the G10 APPROVED B8
 * restore safety rules: (1) only `trash` within `recoverable_until` is
 * restored, `deleting`/`deleted`/expired rejected with the current status;
 * (2) alerts are NOT auto-restarted; (3) revoked private tokens are NOT
 * restored; (4) disabled client keys are NOT re-enabled; (5) membership/roles
 * are recomputed against current org state; (6) no resurrection of a deletion
 * cleanup state. Optimistic concurrency via `resourceVersion` (project
 * updatedAt); `version_conflict` carries the current version. Transactional:
 * status change, membership recompute and the `project.restored` audit row are
 * committed atomically.
 */
export async function restoreProject(
  pool: Pool | PoolClient,
  input: RestoreProjectInput,
): Promise<RestoreProjectResult> {
  try {
    return isPoolClient(pool)
      ? await runRestoreProject(pool, input)
      : await withTransaction(pool, (client) => runRestoreProject(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
