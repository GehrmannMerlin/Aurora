/**
 * C3 Issue 列表（`project.issues`）view-model（PLT-06）。
 *
 * URL 是筛选/分页的当前权威来源（UX §9.16）；本模块只做 URL ⇄ 查询输入的纯
 * 转换与分页合并，不做业务状态重算。缺失证据一律 `empty`/`unavailable`。
 */
import type { IssueListData, IssueSummary } from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';
import { toSectionView } from '../../monitoring/section.js';

export interface IssueFilters {
  readonly status?: string;
  readonly priority?: string;
  readonly assigneeAccountId?: string;
}

export type QueryValue = string | null | (string | null)[];

/** Parse the URL query into the approved issue filters (empty/unknown values are dropped). */
export function parseIssueFilters(query: Readonly<Record<string, QueryValue>>): IssueFilters {
  const result: { status?: string; priority?: string; assigneeAccountId?: string } = {};
  const status = query.status;
  if (typeof status === 'string' && status.length > 0) result.status = status;
  const priority = query.priority;
  if (typeof priority === 'string' && priority.length > 0) result.priority = priority;
  const assignee = query.assigneeAccountId;
  if (typeof assignee === 'string' && assignee.length > 0) result.assigneeAccountId = assignee;
  return result;
}

/** Build the fetch query (timeRange required by DAT-15) from filters + optional cursor. */
export function issueListQuery(
  filters: IssueFilters,
  timeRange: { readonly start: string; readonly end: string },
  cursor?: string,
): {
  readonly timeRange: { readonly start: string; readonly end: string };
  readonly status?: string;
  readonly priority?: string;
  readonly assigneeAccountId?: string;
  readonly cursor?: string;
} {
  const query: {
    timeRange: { start: string; end: string };
    status?: string;
    priority?: string;
    assigneeAccountId?: string;
    cursor?: string;
  } = { timeRange: { start: timeRange.start, end: timeRange.end } };
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.priority !== undefined) query.priority = filters.priority;
  if (filters.assigneeAccountId !== undefined) query.assigneeAccountId = filters.assigneeAccountId;
  if (cursor !== undefined) query.cursor = cursor;
  return query;
}

/** URL query to persist (filters only, never page/cursor). */
export function issueFiltersToQuery(
  filters: IssueFilters,
  timeRange: { readonly start: string; readonly end: string },
): Record<string, string> {
  const query: Record<string, string> = {
    'timeRange[start]': timeRange.start,
    'timeRange[end]': timeRange.end,
  };
  if (filters.status !== undefined) query.status = filters.status;
  if (filters.priority !== undefined) query.priority = filters.priority;
  if (filters.assigneeAccountId !== undefined) query.assigneeAccountId = filters.assigneeAccountId;
  return query;
}

export interface IssueListPageState {
  readonly view: SectionView<{ readonly totalCount: number; readonly totalCountStatus: string }>;
  readonly items: readonly IssueSummary[];
  readonly nextCursor: string | null;
}

/** Merge a fetched page into the running list (items append, nextCursor replaces). */
export function mergeIssuePage(
  previous: readonly IssueSummary[],
  page: IssueListData,
): IssueListPageState {
  const section = page.issues;
  if (section.status === 'available') {
    return {
      view: {
        kind: 'available',
        data: {
          totalCount: section.pagination.totalCount,
          totalCountStatus: section.pagination.totalCountStatus,
        },
      },
      items: [...previous, ...section.items],
      nextCursor: section.pagination.nextCursor ?? null,
    };
  }
  const view = toSectionView<{ totalCount: number; totalCountStatus: string }>({
    loading: false,
    error: null,
    section:
      section.status === 'empty'
        ? { status: 'empty', reason: section.reason ?? '窗口内没有问题' }
        : { status: 'unavailable', reason: section.reason ?? '问题证据不可用' },
  });
  return { view, items: [], nextCursor: null };
}
