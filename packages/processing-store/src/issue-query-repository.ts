import type { Pool, PoolClient } from 'pg';
import { ProcessingStoreError } from './errors.js';
import type {
  IssueActivityTimeline,
  IssueDetail,
  IssueListPage,
  IssueListQuery,
  IssueSampleProjection,
} from './issue-query-types.js';

/** Keyset cursor: base64(`{lastSeenAtIso}|{issueId}`). */
export function encodeIssueCursor(lastSeenAtIso: string, issueId: string): string {
  return Buffer.from(`${lastSeenAtIso}|${issueId}`).toString('base64url');
}

export function decodeIssueCursor(cursor: string): { lastSeenAtIso: string; issueId: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('|');
    if (sep <= 0) return null;
    return { lastSeenAtIso: raw.slice(0, sep), issueId: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}

interface IssueListRow {
  id: string;
  normalized_title: string;
  status: string;
  occurrence_count: string;
  sample_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  assignee_account_id: string | null;
  priority: string | null;
  version: number;
}

function toSummary(row: IssueListRow): IssueListPage['items'][number] {
  return {
    issueId: row.id,
    title: row.normalized_title,
    status: row.status,
    occurrenceCount: row.occurrence_count,
    sampleCount: row.sample_count,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    ...(row.assignee_account_id === null ? {} : { assigneeAccountId: row.assignee_account_id }),
    ...(row.priority === null ? {} : { priority: row.priority }),
    version: row.version,
  };
}

/**
 * List Issues for a project with keyset pagination (newest last_seen first) and
 * optional status/assignee/priority filters. Read-only; the caller's
 * project-access guard runs before this is invoked.
 */
export async function queryIssueListPage(
  pool: Pool | PoolClient,
  query: IssueListQuery,
): Promise<IssueListPage> {
  const limit = query.limit === undefined ? 50 : Math.min(Math.max(query.limit, 1), 100);
  try {
    const where: string[] = ['project_id = $1'];
    const params: unknown[] = [query.projectId];
    if (query.startIso !== undefined) {
      params.push(query.startIso);
      where.push(`last_seen_at >= $${String(params.length)}::timestamptz`);
    }
    if (query.endIso !== undefined) {
      params.push(query.endIso);
      where.push(`last_seen_at < $${String(params.length)}::timestamptz`);
    }
    if (query.status !== undefined) {
      params.push(query.status);
      where.push(`status = $${String(params.length)}`);
    }
    if (query.assigneeAccountId !== undefined) {
      params.push(query.assigneeAccountId);
      where.push(`assignee_account_id = $${String(params.length)}`);
    }
    if (query.priority !== undefined) {
      params.push(query.priority);
      where.push(`priority = $${String(params.length)}`);
    }
    const decoded = query.cursor === undefined ? null : decodeIssueCursor(query.cursor);
    if (query.cursor !== undefined && decoded === null) {
      throw new ProcessingStoreError('invalid_input', 'malformed issue cursor');
    }
    if (decoded !== null) {
      params.push(decoded.lastSeenAtIso, decoded.issueId);
      where.push(`(last_seen_at, id) < ($` + String(params.length - 1) + `::timestamptz, $` + String(params.length) + `)`);
    }
    params.push(limit);
    const rows = await pool.query<IssueListRow>(
      `SELECT id, normalized_title, status, occurrence_count, sample_count, first_seen_at,
              last_seen_at, assignee_account_id, priority, version
         FROM issues
        WHERE ${where.join(' AND ')}
        ORDER BY last_seen_at DESC, id DESC
        LIMIT $${String(params.length)}`,
      params,
    );
    const totalParams: unknown[] = [query.projectId];
    const totalWhere: string[] = ['project_id = $1'];
    if (query.startIso !== undefined) {
      totalParams.push(query.startIso);
      totalWhere.push(`last_seen_at >= $${String(totalParams.length)}::timestamptz`);
    }
    if (query.endIso !== undefined) {
      totalParams.push(query.endIso);
      totalWhere.push(`last_seen_at < $${String(totalParams.length)}::timestamptz`);
    }
    if (query.status !== undefined) {
      totalParams.push(query.status);
      totalWhere.push(`status = $${String(totalParams.length)}`);
    }
    if (query.assigneeAccountId !== undefined) {
      totalParams.push(query.assigneeAccountId);
      totalWhere.push(`assignee_account_id = $${String(totalParams.length)}`);
    }
    if (query.priority !== undefined) {
      totalParams.push(query.priority);
      totalWhere.push(`priority = $${String(totalParams.length)}`);
    }
    const total = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM issues WHERE ${totalWhere.join(' AND ')}`,
      totalParams,
    );
    const items = rows.rows.map(toSummary);
    const last = items[items.length - 1];
    const nextCursor = items.length === limit && last !== undefined ? encodeIssueCursor(last.lastSeenAt, last.issueId) : undefined;
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }), totalCount: total.rows[0]?.count ?? '0' };
  } catch {
    throw new ProcessingStoreError('statement_failed', 'issue list query failed');
  }
}

interface IssueDetailRow {
  id: string;
  normalized_title: string;
  category: string;
  fingerprint_version: number;
  occurrence_count: string;
  sample_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  status: string;
  assignee_account_id: string | null;
  priority: string | null;
  resolved_at: Date | null;
  resolved_version: string | null;
  resolved_reason: string | null;
  ignored_until: Date | null;
  merged_into_issue_id: string | null;
  version: number;
}

export async function queryIssueDetail(
  pool: Pool | PoolClient,
  projectId: string,
  issueId: string,
): Promise<IssueDetail | null> {
  try {
    const result = await pool.query<IssueDetailRow>(
      `SELECT id, normalized_title, category, fingerprint_version, occurrence_count, sample_count,
              first_seen_at, last_seen_at, status, assignee_account_id, priority, resolved_at,
              resolved_version, resolved_reason, ignored_until, merged_into_issue_id, version
         FROM issues WHERE project_id = $1 AND id = $2`,
      [projectId, issueId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      issueId: row.id,
      title: row.normalized_title,
      category: row.category,
      fingerprintVersion: row.fingerprint_version,
      occurrenceCount: row.occurrence_count,
      sampleCount: row.sample_count,
      firstSeenAt: row.first_seen_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      status: row.status,
      ...(row.assignee_account_id === null ? {} : { assigneeAccountId: row.assignee_account_id }),
      ...(row.priority === null ? {} : { priority: row.priority }),
      ...(row.resolved_reason === null ? {} : { resolvedReason: row.resolved_reason }),
      ...(row.resolved_version === null ? {} : { resolvedVersion: row.resolved_version }),
      ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at.toISOString() }),
      ...(row.ignored_until === null ? {} : { ignoredUntil: row.ignored_until.toISOString() }),
      ...(row.merged_into_issue_id === null ? {} : { mergedIntoIssueId: row.merged_into_issue_id }),
      version: row.version,
    };
  } catch {
    throw new ProcessingStoreError('statement_failed', 'issue detail query failed');
  }
}

interface SampleRow {
  id: string;
  occurred_at: Date;
  sample_kind: string;
  sample_body: unknown;
}

/** Bounded safe representative samples (≤100) for an Issue. */
export async function queryIssueSamples(
  pool: Pool | PoolClient,
  projectId: string,
  issueId: string,
  limit = 100,
): Promise<readonly IssueSampleProjection[]> {
  try {
    const result = await pool.query<SampleRow>(
      `SELECT id, occurred_at, sample_kind, sample_body FROM issue_samples
        WHERE project_id = $1 AND issue_id = $2
        ORDER BY occurred_at DESC, id DESC
        LIMIT $3`,
      [projectId, issueId, Math.min(Math.max(limit, 1), 100)],
    );
    return result.rows.map((row) => ({
      sampleId: row.id,
      occurredAt: row.occurred_at.toISOString(),
      sampleKind: row.sample_kind,
      sampleBody: row.sample_body,
    }));
  } catch {
    throw new ProcessingStoreError('statement_failed', 'issue samples query failed');
  }
}

interface ActivityRow {
  activity_type: string;
  created_at: Date;
  actor_account_id: string | null;
  details: unknown;
}

interface NoteRow {
  id: string;
  author_account_id: string;
  content: string;
  created_at: Date;
  deleted_at: Date | null;
}

/**
 * Immutable activity timeline + member notes. Deleted notes are listed without
 * their `content` (admin-sensitive deletion stays effective on read paths).
 */
export async function queryIssueActivity(
  pool: Pool | PoolClient,
  projectId: string,
  issueId: string,
): Promise<IssueActivityTimeline> {
  try {
    const [activities, notes] = await Promise.all([
      pool.query<ActivityRow>(
        `SELECT activity_type, created_at, actor_account_id, details FROM issue_activities
          WHERE project_id = $1 AND issue_id = $2
          ORDER BY created_at ASC, id ASC`,
        [projectId, issueId],
      ),
      pool.query<NoteRow>(
        `SELECT id, author_account_id, content, created_at, deleted_at FROM issue_notes
          WHERE project_id = $1 AND issue_id = $2
          ORDER BY created_at ASC, id ASC`,
        [projectId, issueId],
      ),
    ]);
    return {
      activities: activities.rows.map((row) => ({
        activityType: row.activity_type,
        createdAt: row.created_at.toISOString(),
        ...(row.actor_account_id === null ? {} : { actorAccountId: row.actor_account_id }),
        details: row.details,
      })),
      notes: notes.rows.map((row) => ({
        noteId: row.id,
        authorAccountId: row.author_account_id,
        createdAt: row.created_at.toISOString(),
        ...(row.deleted_at === null
          ? { content: row.content }
          : { deletedAt: row.deleted_at.toISOString() }),
      })),
    };
  } catch {
    throw new ProcessingStoreError('statement_failed', 'issue activity query failed');
  }
}
