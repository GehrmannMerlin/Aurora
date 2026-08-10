/**
 * Read-only Issue query projections (DAT-15 spec §5/§6 / accepted ADR-033
 * decision detail 19). Only safe, project-scoped fields are exposed; raw error
 * messages, full emails, tokens and secrets never leave these types.
 */

export interface IssueListQuery {
  readonly projectId: string;
  /** Half-open window [startIso, endIso) applied to `last_seen_at`. */
  readonly startIso?: string;
  readonly endIso?: string;
  readonly status?: string;
  readonly assigneeAccountId?: string;
  readonly priority?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface IssueSummary {
  readonly issueId: string;
  readonly title: string;
  readonly status: string;
  readonly occurrenceCount: string;
  readonly sampleCount: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly assigneeAccountId?: string;
  readonly priority?: string;
  readonly version: number;
}

export interface IssueListPage {
  readonly items: readonly IssueSummary[];
  readonly nextCursor?: string;
  readonly totalCount: string;
}

export interface IssueDetail {
  readonly issueId: string;
  readonly title: string;
  readonly category: string;
  readonly fingerprintVersion: number;
  readonly occurrenceCount: string;
  readonly sampleCount: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly status: string;
  readonly assigneeAccountId?: string;
  readonly priority?: string;
  readonly resolvedReason?: string;
  readonly resolvedVersion?: string;
  readonly resolvedAt?: string;
  readonly ignoredUntil?: string;
  readonly mergedIntoIssueId?: string;
  readonly version: number;
}

export interface IssueSampleProjection {
  readonly sampleId: string;
  readonly occurredAt: string;
  readonly sampleKind: string;
  readonly sampleBody: unknown;
}

export interface IssueActivityEntry {
  readonly activityType: string;
  readonly createdAt: string;
  readonly actorAccountId?: string;
  readonly details: unknown;
}

export interface IssueNoteProjection {
  readonly noteId: string;
  readonly authorAccountId: string;
  readonly content?: string;
  readonly createdAt: string;
  readonly deletedAt?: string;
}

export interface IssueActivityTimeline {
  readonly activities: readonly IssueActivityEntry[];
  readonly notes: readonly IssueNoteProjection[];
}
