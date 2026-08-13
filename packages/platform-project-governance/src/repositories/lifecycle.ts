import type { Pool, PoolClient } from 'pg';
import { toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { isoVersionKey } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';
import type { ProjectStatus } from './projects.js';

/**
 * C16 restore-from-archive (UX/UI §8.29 / PRD §17.2). Distinct from the B8
 * trash→active restore (`restoreProject`, which enforces the recovery window);
 * this command restores an `archived` project to `active` with optimistic
 * concurrency. Alerts stay off and revoked tokens stay revoked — the restore
 * only flips the lifecycle state (same rule as B8 restore).
 */

export interface RestoreFromArchiveInput {
  readonly orgId: string;
  readonly projectId: string;
  readonly expectedVersion: string;
  readonly actorId: string;
}

export type RestoreFromArchiveResult =
  | { readonly status: 'success'; readonly projectId: string; readonly projectStatus: 'active' }
  | { readonly status: 'not_found' }
  | { readonly status: 'version_conflict'; readonly currentResourceVersion: string }
  | { readonly status: 'state_machine_conflict'; readonly currentStatus: ProjectStatus };

interface ProjectLockShape {
  status: ProjectStatus;
  updated_at: Date | string;
}

async function runRestoreFromArchive(
  client: PoolClient,
  input: RestoreFromArchiveInput,
): Promise<RestoreFromArchiveResult> {
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
  if (row.status !== 'archived') {
    return { status: 'state_machine_conflict', currentStatus: row.status };
  }

  await client.query(
    `UPDATE projects
     SET status = 'active', archived_at = NULL, updated_at = now()
     WHERE project_id = $1`,
    [input.projectId],
  );

  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'project.restored_from_archive',
    details: { projectId: input.projectId },
  });

  return { status: 'success', projectId: input.projectId, projectStatus: 'active' };
}

/** Restore an archived project to active (alerts stay off; audited). */
export async function restoreFromArchive(
  pool: Pool | PoolClient,
  input: RestoreFromArchiveInput,
): Promise<RestoreFromArchiveResult> {
  try {
    return isPoolClient(pool)
      ? await runRestoreFromArchive(pool, input)
      : await withTransaction(pool, (client) => runRestoreFromArchive(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
