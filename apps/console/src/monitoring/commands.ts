/**
 * Issue lifecycle Command client (PLT-06 C4).
 *
 * Typed wrappers over the DAT-14 public Commands (issuesUpdateState /
 * issuesUpdateAssignee / issuesUpdatePriority / issuesCreateNote /
 * issuesDeleteNote / issuesMerge). Every call goes through the generated client
 * (`executeQuery`) with the session CSRF and a fresh idempotency key; the
 * backend re-authorizes on every Command (`read_only` → 403). The frontend
 * never hides buttons based on an assumed role (DAT-14 spec §4).
 */
import {
  OPERATION_ID_CREATE_ISSUE_NOTE,
  OPERATION_ID_DELETE_ISSUE_NOTE,
  OPERATION_ID_MERGE_ISSUES,
  OPERATION_ID_UPDATE_ISSUE_ASSIGNEE,
  OPERATION_ID_UPDATE_ISSUE_PRIORITY,
  OPERATION_ID_UPDATE_ISSUE_STATE,
} from '@aurora/platform-contract';
import { executeQuery } from '../api/query.js';
import { createIdempotencyKey } from '../api/client.js';
import type { ScopeKey } from '../api/scope.js';
import type { ProjectScope } from './queries.js';

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'ignored' | 'reopened';
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low';

export interface CommandActivity {
  readonly type: string;
  readonly createdAt: string;
  readonly actorAccountId?: string;
}

export interface IssueCommandResult {
  readonly status: string;
  readonly issueId: string;
  readonly version: number;
  readonly activity: CommandActivity;
}

export interface IssueCommandOptions {
  readonly csrf: string;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

function projectScope(scope: ProjectScope): ScopeKey {
  return { type: 'project', id: scope.projectId };
}

async function runCommand<T>(
  operationId: string,
  scope: ProjectScope,
  pathParams: Readonly<Record<string, string>>,
  body: Readonly<Record<string, unknown>>,
  options: IssueCommandOptions,
): Promise<T> {
  const input = {
    pathParams,
    body: { ...body, idempotencyKey: options.idempotencyKey ?? createIdempotencyKey() },
  };
  const data = await executeQuery<{ readonly data: T }>({
    operationId,
    input,
    scope: projectScope(scope),
    csrf: options.csrf,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  return data.data;
}

export function updateIssueState(
  scope: ProjectScope,
  issueId: string,
  params: {
    readonly status: string;
    readonly version: number;
    readonly resolution?: {
      readonly reason: string;
      readonly version?: string;
      readonly resolvedAtIso?: string;
    };
    readonly ignoredUntilIso?: string;
  },
  options: IssueCommandOptions,
): Promise<IssueCommandResult> {
  const body: Record<string, unknown> = { status: params.status, version: params.version };
  if (params.resolution !== undefined) body.resolution = params.resolution;
  if (params.ignoredUntilIso !== undefined) body.ignoredUntilIso = params.ignoredUntilIso;
  return runCommand<IssueCommandResult>(
    OPERATION_ID_UPDATE_ISSUE_STATE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, issueId },
    body,
    options,
  );
}

export function updateIssueAssignee(
  scope: ProjectScope,
  issueId: string,
  params: { readonly assigneeAccountId?: string; readonly version: number },
  options: IssueCommandOptions,
): Promise<IssueCommandResult> {
  const body: Record<string, unknown> = { version: params.version };
  if (params.assigneeAccountId !== undefined) body.assigneeAccountId = params.assigneeAccountId;
  return runCommand<IssueCommandResult>(
    OPERATION_ID_UPDATE_ISSUE_ASSIGNEE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, issueId },
    body,
    options,
  );
}

export function updateIssuePriority(
  scope: ProjectScope,
  issueId: string,
  params: { readonly priority?: string; readonly version: number },
  options: IssueCommandOptions,
): Promise<IssueCommandResult> {
  const body: Record<string, unknown> = { version: params.version };
  if (params.priority !== undefined) body.priority = params.priority;
  return runCommand<IssueCommandResult>(
    OPERATION_ID_UPDATE_ISSUE_PRIORITY,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, issueId },
    body,
    options,
  );
}

export interface CreateNoteResult {
  readonly status: string;
  readonly issueId: string;
  readonly noteId: string;
}

export function createIssueNote(
  scope: ProjectScope,
  issueId: string,
  params: { readonly content: string },
  options: IssueCommandOptions,
): Promise<CreateNoteResult> {
  return runCommand<CreateNoteResult>(
    OPERATION_ID_CREATE_ISSUE_NOTE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, issueId },
    { content: params.content },
    options,
  );
}

export function deleteIssueNote(
  scope: ProjectScope,
  issueId: string,
  noteId: string,
  options: IssueCommandOptions,
): Promise<CreateNoteResult> {
  return runCommand<CreateNoteResult>(
    OPERATION_ID_DELETE_ISSUE_NOTE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, issueId, noteId },
    {},
    options,
  );
}

export interface MergeIssuesResult {
  readonly status: string;
  readonly issueId: string;
  readonly mergedIntoIssueId: string;
}

export function mergeIssues(
  scope: ProjectScope,
  issueId: string,
  params: { readonly primaryIssueId: string; readonly version: number },
  options: IssueCommandOptions,
): Promise<MergeIssuesResult> {
  return runCommand<MergeIssuesResult>(
    OPERATION_ID_MERGE_ISSUES,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, issueId },
    { primaryIssueId: params.primaryIssueId, version: params.version },
    options,
  );
}
