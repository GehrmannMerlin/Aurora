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
  OPERATION_ID_ALERTS_CREATE_RULE,
  OPERATION_ID_ALERTS_UPDATE_RULE,
  OPERATION_ID_CREATE_ISSUE_NOTE,
  OPERATION_ID_DELETE_ISSUE_NOTE,
  OPERATION_ID_MERGE_ISSUES,
  OPERATION_ID_SOURCE_MAPS_REPARSE,
  OPERATION_ID_SOURCE_MAPS_REPLACE,
  OPERATION_ID_SOURCE_MAPS_UPLOAD,
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

// --- DAT-18 Source Map commands (C9) -----------------------------------------------------------

export interface UploadSourceMapResult {
  readonly status: string;
  readonly releaseId: string;
  readonly sourceMapFileId?: string;
  readonly currentDigest?: string;
  readonly version?: number;
}

/** Upload a Source Map for a release build path (idempotent digest; replace needs explicit confirm). */
export function uploadSourceMap(
  scope: ProjectScope,
  params: {
    readonly releaseVersion: string;
    readonly buildPath: string;
    readonly content: string;
    readonly digest: string;
    readonly buildId?: string;
  },
  options: IssueCommandOptions,
): Promise<UploadSourceMapResult> {
  const body: Record<string, unknown> = {
    releaseVersion: params.releaseVersion,
    buildPath: params.buildPath,
    content: params.content,
    digest: params.digest,
  };
  if (params.buildId !== undefined) body.buildId = params.buildId;
  return runCommand<UploadSourceMapResult>(
    OPERATION_ID_SOURCE_MAPS_UPLOAD,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId },
    body,
    options,
  );
}

export interface ReplaceSourceMapResult {
  readonly status: string;
  readonly sourceMapFileId: string;
  readonly version: number;
}

/** Explicitly replace a Source Map after a digest conflict (versioned, audited). */
export function replaceSourceMap(
  scope: ProjectScope,
  releaseId: string,
  sourceMapFileId: string,
  params: { readonly content: string; readonly digest: string; readonly version: number },
  options: IssueCommandOptions,
): Promise<ReplaceSourceMapResult> {
  return runCommand<ReplaceSourceMapResult>(
    OPERATION_ID_SOURCE_MAPS_REPLACE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, releaseId, sourceMapFileId },
    { content: params.content, digest: params.digest, version: params.version },
    options,
  );
}

export interface ReparseReleaseResult {
  readonly status: string;
  readonly releaseId: string;
  readonly taskCount: number;
}

/** Queue a bounded reparse for a release (retry/refresh symbolication). */
export function reparseRelease(
  scope: ProjectScope,
  releaseId: string,
  options: IssueCommandOptions,
): Promise<ReparseReleaseResult> {
  return runCommand<ReparseReleaseResult>(
    OPERATION_ID_SOURCE_MAPS_REPARSE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, releaseId },
    {},
    options,
  );
}

// --- DAT-19 Alert rule commands (C11) ------------------------------------------------------------

export interface AlertFilters {
  readonly environment: readonly string[];
  readonly release: readonly string[];
  readonly pageOrEndpoint: readonly string[];
  readonly errorSeverity: readonly string[];
}

export interface AlertRuleInput {
  readonly name?: string;
  readonly metric: string;
  readonly filters: AlertFilters;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly triggerDurationMinutes: number;
  readonly recoveryThreshold: number;
  readonly recoveryDurationMinutes?: number;
  readonly minSampleCount?: number;
  readonly cooldownMinutes: number;
  readonly recipientAccountIds: readonly string[];
}

export interface AlertRuleCommandResult {
  readonly status: string;
  readonly ruleId: string;
  readonly version?: number;
}

function toAlertBody(input: AlertRuleInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    metric: input.metric,
    filters: input.filters,
    windowMinutes: input.windowMinutes,
    triggerThreshold: input.triggerThreshold,
    triggerDurationMinutes: input.triggerDurationMinutes,
    recoveryThreshold: input.recoveryThreshold,
    cooldownMinutes: input.cooldownMinutes,
    recipientAccountIds: input.recipientAccountIds,
  };
  if (input.name !== undefined) body.name = input.name;
  if (input.recoveryDurationMinutes !== undefined)
    body.recoveryDurationMinutes = input.recoveryDurationMinutes;
  if (input.minSampleCount !== undefined) body.minSampleCount = input.minSampleCount;
  return body;
}

export function createAlertRule(
  scope: ProjectScope,
  input: AlertRuleInput,
  options: IssueCommandOptions,
): Promise<AlertRuleCommandResult> {
  return runCommand<AlertRuleCommandResult>(
    OPERATION_ID_ALERTS_CREATE_RULE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId },
    toAlertBody(input),
    options,
  );
}

export function updateAlertRule(
  scope: ProjectScope,
  ruleId: string,
  input: AlertRuleInput,
  params: { readonly version: number },
  options: IssueCommandOptions,
): Promise<AlertRuleCommandResult> {
  return runCommand<AlertRuleCommandResult>(
    OPERATION_ID_ALERTS_UPDATE_RULE,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId, ruleId },
    { ...toAlertBody(input), version: params.version },
    options,
  );
}
