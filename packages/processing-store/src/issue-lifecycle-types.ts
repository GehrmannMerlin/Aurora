/**
 * Stable public input/result contracts for the Issue lifecycle Commands
 * (DAT-14 spec §3—§8 / accepted ADR-033 decision details 3/4/5c/5d). The
 * repositories run inside the caller's command transaction (a PoolClient) and
 * never expose pg Result objects or database errors.
 */

export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'ignored'] as const;
export const ISSUE_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export const MAX_ISSUE_NOTE_LENGTH = 4096 as const;

/** PRD §10.1 status transition table (resolved/ignored reopen via `open` only). */
export const ALLOWED_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  open: ['in_progress', 'resolved', 'ignored'],
  in_progress: ['open', 'resolved', 'ignored'],
  resolved: ['open'],
  ignored: ['open'],
};

export type Resolution =
  | { readonly reason: 'by_version'; readonly version: string }
  | { readonly reason: 'by_time'; readonly resolvedAtIso: string };

export interface UpdateIssueStateInput {
  readonly issueId: string;
  readonly projectId: string;
  readonly status: string;
  readonly version: number;
  readonly actorAccountId: string;
  readonly resolution?: Resolution;
  readonly ignoredUntilIso?: string;
  /** Auto-assign on start-processing (PRD §10.2). Default true; false for batch. */
  readonly autoAssign?: boolean;
}

export interface UpdateIssueAssigneeInput {
  readonly issueId: string;
  readonly projectId: string;
  readonly assigneeAccountId: string | null;
  readonly version: number;
  readonly actorAccountId: string;
}

export interface UpdateIssuePriorityInput {
  readonly issueId: string;
  readonly projectId: string;
  readonly priority: string | null;
  readonly version: number;
  readonly actorAccountId: string;
}

export interface CreateIssueNoteInput {
  readonly issueId: string;
  readonly projectId: string;
  readonly authorAccountId: string;
  readonly content: string;
}

export interface DeleteIssueNoteInput {
  readonly issueId: string;
  readonly projectId: string;
  readonly noteId: string;
  readonly actorAccountId: string;
  /** org manager or project_admin may delete any note (PRD §10.6 sensitive). */
  readonly canDeleteSensitive: boolean;
}

export interface MergeIssuesInput {
  readonly issueId: string;
  readonly primaryIssueId: string;
  readonly projectId: string;
  readonly version: number;
  readonly actorAccountId: string;
}

export interface IssueBatchItem {
  readonly issueId: string;
  readonly action: 'status' | 'assignee' | 'priority';
  readonly target: string | null;
  readonly version: number;
}

export interface BatchUpdateIssuesInput {
  readonly projectId: string;
  readonly items: readonly IssueBatchItem[];
  readonly actorAccountId: string;
}

export type IssueLifecycleResult =
  | { readonly status: 'succeeded'; readonly issueId: string; readonly noteId?: string }
  | { readonly status: 'conflict' }
  | { readonly status: 'not_found' }
  | { readonly status: 'forbidden' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export type IssueBatchItemResult =
  | { readonly issueId: string; readonly ok: true }
  | { readonly issueId: string; readonly ok: false; readonly code: string };

export interface IssueBatchResult {
  readonly succeeded: number;
  readonly failed: number;
  readonly items: readonly IssueBatchItemResult[];
}
