import type { PoolClient } from 'pg';
import {
  ALLOWED_STATUS_TRANSITIONS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  MAX_ISSUE_NOTE_LENGTH,
  type BatchUpdateIssuesInput,
  type CreateIssueNoteInput,
  type DeleteIssueNoteInput,
  type IssueBatchItemResult,
  type IssueBatchResult,
  type IssueLifecycleResult,
  type MergeIssuesInput,
  type UpdateIssueAssigneeInput,
  type UpdateIssuePriorityInput,
  type UpdateIssueStateInput,
} from './issue-lifecycle-types.js';

interface IssueStateRow {
  readonly id: string;
  readonly status: string;
  readonly assigneeAccountId: string | null;
  readonly version: number;
  readonly resolvedAt: Date | null;
  readonly resolvedReason: string | null;
  readonly ignoredUntil: Date | null;
  readonly occurrenceCount: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

function invalid(code: string): IssueLifecycleResult {
  return { status: 'invalid_input', code };
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

async function selectIssue(client: PoolClient, issueId: string, projectId: string): Promise<IssueStateRow | null> {
  const result = await client.query<{
    id: string;
    status: string;
    assignee_account_id: string | null;
    version: number;
    resolved_at: Date | null;
    resolved_reason: string | null;
    ignored_until: Date | null;
    occurrence_count: string;
    first_seen_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT id, status, assignee_account_id, version, resolved_at, resolved_reason, ignored_until,
            occurrence_count, first_seen_at, last_seen_at
       FROM issues WHERE id = $1 AND project_id = $2 FOR UPDATE`,
    [issueId, projectId],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    status: row.status,
    assigneeAccountId: row.assignee_account_id,
    version: row.version,
    resolvedAt: row.resolved_at,
    resolvedReason: row.resolved_reason,
    ignoredUntil: row.ignored_until,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

async function appendActivity(
  client: PoolClient,
  issueId: string,
  projectId: string,
  actorAccountId: string | null,
  activityType: string,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO issue_activities (issue_id, project_id, actor_account_id, activity_type, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [issueId, projectId, actorAccountId, activityType, JSON.stringify(details)],
  );
}

export function validateStateTransition(current: string, target: string): boolean {
  return (ALLOWED_STATUS_TRANSITIONS[current] ?? []).includes(target);
}

/**
 * Apply a status transition (PRD §10.1/§10.2/§10.4/§10.5) with optimistic
 * `version` conflict detection, auto-assign on start-processing, resolution /
 * ignore payloads, and immutable activity rows. Runs in the caller's transaction.
 */
export async function updateIssueState(
  client: PoolClient,
  input: unknown,
): Promise<IssueLifecycleResult> {
  const record = input as Partial<UpdateIssueStateInput>;
  if (!isInteger(record.version) || typeof record.issueId !== 'string' || typeof record.projectId !== 'string') {
    return invalid('invalid_input');
  }
  const status = record.status;
  if (typeof status !== 'string' || !(ISSUE_STATUSES as readonly string[]).includes(status)) {
    return invalid('invalid_status');
  }
  const actor = record.actorAccountId;
  if (typeof actor !== 'string' || actor.length === 0) return invalid('invalid_actor');

  const issue = await selectIssue(client, record.issueId, record.projectId);
  if (issue === null) return { status: 'not_found' };
  if (!validateStateTransition(issue.status, status)) return invalid('invalid_transition');
  if (issue.version !== record.version) return { status: 'conflict' };

  const resolution = record.resolution;
  if (status === 'resolved') {
    if (resolution === undefined) return invalid('invalid_resolution');
    if (resolution.reason === 'by_version' && typeof resolution.version !== 'string') {
      return invalid('invalid_resolution');
    }
    if (resolution.reason === 'by_time' && typeof resolution.resolvedAtIso !== 'string') {
      return invalid('invalid_resolution');
    }
  }
  if (status === 'ignored' && record.ignoredUntilIso !== undefined && typeof record.ignoredUntilIso !== 'string') {
    return invalid('invalid_ignored_until');
  }

  // Auto-assign on start-processing for an unassigned issue (PRD §10.2). Batch
  // operations pass autoAssign: false — batch never auto-assigns (PRD §10.2).
  const autoAssign =
    (record.autoAssign ?? true) && status === 'in_progress' && issue.assigneeAccountId === null;

  const params: unknown[] = [record.issueId, record.projectId, record.version, status];
  const sets: string[] = ['status = $4', 'version = version + 1', 'updated_at = now()'];
  let next = 5;
  if (autoAssign) {
    sets.push(`assignee_account_id = $${String(next)}`);
    params.push(actor);
    next += 1;
  }
  if (status === 'resolved' && resolution !== undefined) {
    if (resolution.reason === 'by_time') {
      sets.push(
        `resolved_at = $${String(next)}`,
        `resolved_reason = $${String(next + 1)}`,
        'resolved_version = NULL',
      );
      params.push(resolution.resolvedAtIso, 'by_time');
    } else {
      sets.push(
        'resolved_at = now()',
        `resolved_reason = $${String(next)}`,
        `resolved_version = $${String(next + 1)}`,
      );
      params.push('by_version', resolution.version);
    }
  } else if (status === 'ignored') {
    sets.push(`ignored_until = $${String(next)}`);
    params.push(record.ignoredUntilIso ?? null);
  } else if (status === 'open') {
    sets.push('resolved_at = NULL', 'resolved_reason = NULL', 'resolved_version = NULL', 'ignored_until = NULL');
  }

  const updated = await client.query(
    `UPDATE issues SET ${sets.join(', ')} WHERE id = $1 AND project_id = $2 AND version = $3`,
    params,
  );
  if ((updated.rowCount ?? 0) === 0) return { status: 'conflict' };

  await appendActivity(client, issue.id, record.projectId, actor, 'status_changed', {
    from: issue.status,
    to: status,
  });
  if (autoAssign) {
    await appendActivity(client, issue.id, record.projectId, actor, 'assignee_changed', {
      to: actor,
      autoAssigned: true,
    });
  }
  if (status === 'resolved' && resolution !== undefined) {
    await appendActivity(client, issue.id, record.projectId, actor, 'marked_resolved', {
      reason: resolution.reason,
    });
  }
  if (status === 'ignored') {
    await appendActivity(client, issue.id, record.projectId, actor, 'ignored', {
      ignoredUntil: record.ignoredUntilIso ?? null,
    });
  }
  if (status === 'open' && issue.status !== 'open') {
    await appendActivity(client, issue.id, record.projectId, actor, 'reopened', {});
  }
  return { status: 'succeeded', issueId: issue.id };
}

export async function updateIssueAssignee(
  client: PoolClient,
  input: unknown,
): Promise<IssueLifecycleResult> {
  const record = input as Partial<UpdateIssueAssigneeInput>;
  if (
    !isInteger(record.version) ||
    typeof record.issueId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.actorAccountId !== 'string' ||
    (record.assigneeAccountId !== null && typeof record.assigneeAccountId !== 'string')
  ) {
    return invalid('invalid_input');
  }
  const issue = await selectIssue(client, record.issueId, record.projectId);
  if (issue === null) return { status: 'not_found' };
  if (issue.version !== record.version) return { status: 'conflict' };

  const updated = await client.query(
    `UPDATE issues SET assignee_account_id = $4, version = version + 1, updated_at = now()
      WHERE id = $1 AND project_id = $2 AND version = $3`,
    [record.issueId, record.projectId, record.version, record.assigneeAccountId],
  );
  if ((updated.rowCount ?? 0) === 0) return { status: 'conflict' };
  await appendActivity(client, issue.id, record.projectId, record.actorAccountId, 'assignee_changed', {
    to: record.assigneeAccountId,
  });
  return {
    status: 'succeeded',
    issueId: issue.id,
    // PLT-09: expose the previous assignee so the caller can notify only on a
    // real assignment change (append-only; the command outcome is unchanged).
    previousAssigneeAccountId: issue.assigneeAccountId,
  };
}

export async function updateIssuePriority(
  client: PoolClient,
  input: unknown,
): Promise<IssueLifecycleResult> {
  const record = input as Partial<UpdateIssuePriorityInput>;
  if (
    !isInteger(record.version) ||
    typeof record.issueId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.actorAccountId !== 'string' ||
    (record.priority !== null && typeof record.priority !== 'string')
  ) {
    return invalid('invalid_input');
  }
  if (record.priority !== null && !(ISSUE_PRIORITIES as readonly string[]).includes(record.priority)) {
    return invalid('invalid_priority');
  }
  const issue = await selectIssue(client, record.issueId, record.projectId);
  if (issue === null) return { status: 'not_found' };
  if (issue.version !== record.version) return { status: 'conflict' };

  const updated = await client.query(
    `UPDATE issues SET priority = $4, version = version + 1, updated_at = now()
      WHERE id = $1 AND project_id = $2 AND version = $3`,
    [record.issueId, record.projectId, record.version, record.priority],
  );
  if ((updated.rowCount ?? 0) === 0) return { status: 'conflict' };
  await appendActivity(client, issue.id, record.projectId, record.actorAccountId, 'priority_changed', {
    to: record.priority,
  });
  return { status: 'succeeded', issueId: issue.id };
}

export async function createIssueNote(
  client: PoolClient,
  input: unknown,
): Promise<IssueLifecycleResult> {
  const record = input as Partial<CreateIssueNoteInput>;
  if (
    typeof record.issueId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.authorAccountId !== 'string' ||
    typeof record.content !== 'string' ||
    record.content.length === 0 ||
    record.content.length > MAX_ISSUE_NOTE_LENGTH
  ) {
    return invalid('invalid_input');
  }
  const issue = await selectIssue(client, record.issueId, record.projectId);
  if (issue === null) return { status: 'not_found' };

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO issue_notes (issue_id, project_id, author_account_id, content)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [record.issueId, record.projectId, record.authorAccountId, record.content],
  );
  await appendActivity(client, issue.id, record.projectId, record.authorAccountId, 'note_added', {});
  return {
    status: 'succeeded',
    issueId: issue.id,
    noteId: inserted.rows[0]?.id ?? '',
  };
}

export async function deleteIssueNote(
  client: PoolClient,
  input: unknown,
): Promise<IssueLifecycleResult> {
  const record = input as Partial<DeleteIssueNoteInput>;
  if (
    typeof record.issueId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.noteId !== 'string' ||
    typeof record.actorAccountId !== 'string' ||
    typeof record.canDeleteSensitive !== 'boolean'
  ) {
    return invalid('invalid_input');
  }
  const issue = await selectIssue(client, record.issueId, record.projectId);
  if (issue === null) return { status: 'not_found' };

  const note = await client.query<{ id: string; author_account_id: string }>(
    `SELECT id, author_account_id FROM issue_notes
      WHERE id = $1 AND issue_id = $2 AND project_id = $3 AND deleted_at IS NULL`,
    [record.noteId, record.issueId, record.projectId],
  );
  if (note.rows[0] === undefined) return { status: 'not_found' };
  const isAuthor = note.rows[0].author_account_id === record.actorAccountId;
  if (!isAuthor && !record.canDeleteSensitive) return { status: 'forbidden' };

  await client.query(
    `UPDATE issue_notes SET deleted_at = now(), deleted_by_account_id = $4
      WHERE id = $1 AND issue_id = $2 AND project_id = $3`,
    [record.noteId, record.issueId, record.projectId, record.actorAccountId],
  );
  await appendActivity(client, issue.id, record.projectId, record.actorAccountId, 'note_deleted', {});
  return { status: 'succeeded', issueId: issue.id };
}

export async function mergeIssues(
  client: PoolClient,
  input: unknown,
): Promise<IssueLifecycleResult> {
  const record = input as Partial<MergeIssuesInput>;
  if (
    !isInteger(record.version) ||
    typeof record.issueId !== 'string' ||
    typeof record.projectId !== 'string' ||
    typeof record.primaryIssueId !== 'string' ||
    typeof record.actorAccountId !== 'string'
  ) {
    return invalid('invalid_input');
  }
  const source = await selectIssue(client, record.issueId, record.projectId);
  if (source === null) return { status: 'not_found' };
  const primary = await selectIssue(client, record.primaryIssueId, record.projectId);
  if (primary === null) return { status: 'not_found' };
  if (record.issueId === record.primaryIssueId) return invalid('invalid_primary');
  if (source.version !== record.version) return { status: 'conflict' };

  // Re-aggregate counts/first/last into the primary; mark the source merged.
  await client.query(
    `UPDATE issues
        SET occurrence_count = occurrence_count + $3::bigint,
            first_seen_at = LEAST(first_seen_at, $4::timestamptz),
            last_seen_at = GREATEST(last_seen_at, $5::timestamptz),
            updated_at = now()
      WHERE id = $1 AND project_id = $2`,
    [record.primaryIssueId, record.projectId, source.occurrenceCount, source.firstSeenAt, source.lastSeenAt],
  );
  await client.query(
    `UPDATE issues SET merged_into_issue_id = $3, version = version + 1, updated_at = now()
      WHERE id = $1 AND project_id = $2 AND version = $4`,
    [record.issueId, record.projectId, record.primaryIssueId, record.version],
  );
  await appendActivity(client, source.id, record.projectId, record.actorAccountId, 'merged', {
    into: record.primaryIssueId,
  });
  return { status: 'succeeded', issueId: record.primaryIssueId };
}

/**
 * Page-scoped batch (PRD §10.7): ≤100 items, each independently validated and
 * applied via the single-issue command paths; returns per-item success/failure.
 */
export async function batchUpdateIssues(
  client: PoolClient,
  input: unknown,
): Promise<{ status: 'succeeded'; result: IssueBatchResult } | { status: 'invalid_input'; code: string }> {
  const record = input as Partial<BatchUpdateIssuesInput>;
  if (typeof record.projectId !== 'string' || !Array.isArray(record.items)) {
    return { status: 'invalid_input', code: 'invalid_input' };
  }
  if (record.items.length === 0 || record.items.length > 100) {
    return { status: 'invalid_input', code: 'invalid_batch_size' };
  }
  if (typeof record.actorAccountId !== 'string') {
    return { status: 'invalid_input', code: 'invalid_input' };
  }

  const items: IssueBatchItemResult[] = [];
  let succeeded = 0;
  let failed = 0;
  for (const item of record.items as {
    issueId?: unknown;
    action?: unknown;
    target?: unknown;
    version?: unknown;
  }[]) {
    if (typeof item.issueId !== 'string' || typeof item.action !== 'string' || !isInteger(item.version)) {
      failed += 1;
      items.push({ issueId: item.issueId as string, ok: false, code: 'invalid_item' });
      continue;
    }
    const base = {
      issueId: item.issueId,
      projectId: record.projectId,
      version: item.version,
      actorAccountId: record.actorAccountId,
    };
    let result: IssueLifecycleResult;
    if (item.action === 'status') {
      // PRD §10.2: batch never auto-assigns.
      result = await updateIssueState(client, { ...base, status: item.target, autoAssign: false });
    } else if (item.action === 'assignee') {
      result = await updateIssueAssignee(client, {
        ...base,
        assigneeAccountId: item.target === null ? null : (item.target as string),
      });
    } else if (item.action === 'priority') {
      result = await updateIssuePriority(client, {
        ...base,
        priority: item.target === null ? null : (item.target as string),
      });
    } else {
      result = invalid('invalid_action');
    }
    if (result.status === 'succeeded') {
      succeeded += 1;
      items.push({ issueId: item.issueId, ok: true });
    } else {
      failed += 1;
      items.push({ issueId: item.issueId, ok: false, code: result.status });
    }
  }
  return { status: 'succeeded', result: { succeeded, failed, items } };
}
