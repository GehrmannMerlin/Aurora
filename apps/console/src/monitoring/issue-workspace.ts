/**
 * Shared Issue workspace view-model (PLT-06 C3/C4).
 *
 * Pure display mappings for issue status/priority and helpers that normalize a
 * Command result back into the authority detail. No fetch, no store, no DOM.
 */
import type { IssueCommandResult } from './commands.js';

export const ISSUE_STATUS_LABELS: Readonly<Record<string, string>> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  ignored: '已忽略',
  reopened: '重新打开',
};

export const ISSUE_PRIORITY_LABELS: Readonly<Record<string, string>> = {
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
};

export function issueStatusLabel(status: string): string {
  return ISSUE_STATUS_LABELS[status] ?? status;
}

export function issuePriorityLabel(priority: string | undefined): string {
  return priority === undefined ? '未设置' : (ISSUE_PRIORITY_LABELS[priority] ?? priority);
}

export interface IssueDetailState {
  readonly status: string;
  readonly version: number;
  readonly assigneeAccountId?: string;
  readonly priority?: string;
}

/** Fold a Command result back into the authority detail (server-provided values only). */
export function applyCommandResult(
  current: IssueDetailState,
  result: IssueCommandResult,
): IssueDetailState {
  return {
    ...current,
    status: result.status,
    version: result.version,
  };
}
