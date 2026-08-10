/**
 * Typed consumers for the public Platform monitoring Queries (PLT-05/PLT-06).
 *
 * Wraps `executeQuery` for `diagnosticsGetDataStatus` (DAT-20), `issuesListIssues`/
 * `issuesGetIssueDetail` (DAT-15), `requestsListEndpoints` (DAT-16) and
 * `performanceListPages` (DAT-17). Every response type mirrors the corresponding
 * `@aurora/platform-contract` schema; the generated client already validates the
 * wire payload, so the console types only describe what the contract promises.
 */
import {
  OPERATION_ID_GET_DATA_STATUS,
  OPERATION_ID_GET_ISSUE_DETAIL,
  OPERATION_ID_LIST_ISSUES,
  OPERATION_ID_LIST_PERFORMANCE_PAGES,
  OPERATION_ID_LIST_REQUEST_ENDPOINTS,
} from '@aurora/platform-contract';
import { executeQuery } from '../api/query.js';
import type { PlatformRequestInput } from '../api/client.js';
import type { ScopeKey } from '../api/scope.js';
import type { SectionResult } from './section.js';
import type { DiagnosisData } from './diagnosis.js';

export interface ProjectScope {
  readonly organizationId: string;
  readonly projectId: string;
}

export interface FetchOptions {
  readonly signal?: AbortSignal;
  /** Optional RFC 3339 UTC window; the server applies its default window when omitted. */
  readonly timeRange?: { readonly start: string; readonly end: string };
}

function projectScope(scope: ProjectScope): ScopeKey {
  return { type: 'project', id: scope.projectId };
}

/**
 * The generated client returns the full `queryResponse` envelope
 * (`{data, meta, allowedActions, navigationTargets}`); these wrappers unwrap
 * `data` so views consume the projection directly.
 */
interface QueryResponseMeta {
  readonly requestId: string;
  readonly readAt: string;
  readonly normalizedQuery?: Readonly<Record<string, string>>;
}

interface QueryResponse<T> {
  readonly data: T;
  readonly meta: QueryResponseMeta;
  readonly allowedActions: readonly string[];
  readonly navigationTargets: readonly unknown[];
}

export function fetchDataStatus(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<DiagnosisData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  if (options.timeRange !== undefined) input.query = { timeRange: options.timeRange };
  return executeQuery<QueryResponse<DiagnosisData>>({
    operationId: OPERATION_ID_GET_DATA_STATUS,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- DAT-15 Issue list / detail ---------------------------------------------------------------

export interface IssueSummary {
  readonly issueId: string;
  readonly title: string;
  readonly status: string;
  readonly occurrenceCount: number;
  readonly sampleCount: number;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly assigneeAccountId?: string;
  readonly priority?: string;
  readonly version: number;
}

export interface IssueListSection {
  readonly status: string;
  readonly reason?: string;
  readonly items: readonly IssueSummary[];
  readonly pagination: {
    readonly cursor?: string;
    readonly nextCursor?: string;
    readonly totalCount: number;
    readonly totalCountStatus: string;
  };
}

export interface IssueListData {
  readonly issues: IssueListSection;
  readonly filters: { readonly status: string; readonly reason?: string };
  readonly summary: { readonly status: string; readonly reason?: string };
  readonly environments: { readonly status: string; readonly reason?: string };
  readonly releases: { readonly status: string; readonly reason?: string };
}

export interface IssueListQueryInput {
  readonly timeRange: { readonly start: string; readonly end: string };
  readonly status?: string;
  readonly assigneeAccountId?: string;
  readonly priority?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export function fetchIssueList(
  scope: ProjectScope,
  query: IssueListQueryInput,
  options: FetchOptions = {},
): Promise<IssueListData> {
  const queryParams: Record<string, unknown> = { timeRange: query.timeRange };
  if (query.status !== undefined) queryParams.status = query.status;
  if (query.assigneeAccountId !== undefined)
    queryParams.assigneeAccountId = query.assigneeAccountId;
  if (query.priority !== undefined) queryParams.priority = query.priority;
  if (query.cursor !== undefined) queryParams.cursor = query.cursor;
  if (query.limit !== undefined) queryParams.limit = query.limit;
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
    query: queryParams,
  };
  return executeQuery<QueryResponse<IssueListData>>({
    operationId: OPERATION_ID_LIST_ISSUES,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

export interface IssueDetail {
  readonly issueId: string;
  readonly title: string;
  readonly category: string;
  readonly fingerprintVersion: number;
  readonly occurrenceCount: number;
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
  readonly sampleBody: Readonly<Record<string, string>>;
}

export interface IssueActivityEntry {
  readonly activityType: string;
  readonly createdAt: string;
  readonly actorAccountId?: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface IssueNoteProjection {
  readonly noteId: string;
  readonly authorAccountId: string;
  readonly content?: string;
  readonly createdAt: string;
  readonly deletedAt?: string;
}

export interface IssueDetailData {
  readonly issue: {
    readonly status: string;
    readonly reason?: string;
    readonly data?: IssueDetail;
  };
  readonly samples: {
    readonly status: string;
    readonly reason?: string;
    readonly items?: readonly IssueSampleProjection[];
  };
  readonly activity: {
    readonly status: string;
    readonly reason?: string;
    readonly activities?: readonly IssueActivityEntry[];
    readonly notes?: readonly IssueNoteProjection[];
  };
}

export function fetchIssueDetail(
  scope: ProjectScope,
  issueId: string,
  options: FetchOptions = {},
): Promise<IssueDetailData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId, issueId },
  };
  return executeQuery<QueryResponse<IssueDetailData>>({
    operationId: OPERATION_ID_GET_ISSUE_DETAIL,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- DAT-16 Request endpoints ----------------------------------------------------------------

export interface RequestMethodAggregate {
  readonly method: string;
  readonly observedCount: number;
  readonly failureCount: number;
  readonly slowCount: number;
  readonly durationSumMs: number;
  readonly durationMaxMs: number;
  readonly outcomes: readonly { readonly outcome: string; readonly count: number }[];
}

export interface RequestAggregateSummary {
  readonly methods: readonly RequestMethodAggregate[];
  readonly dataThrough?: string;
  readonly isPartial: boolean;
}

export interface RequestEndpointSummary {
  readonly endpointId: string;
  readonly method: string;
  readonly url: string;
  readonly sampleCount: number;
  readonly outcomeCounts: readonly { readonly outcome: string; readonly count: number }[];
  readonly dataThrough?: string;
  readonly isPartial: boolean;
  readonly completeness: { readonly source: string; readonly bounded: boolean };
}

export interface RequestEndpointsData {
  readonly summary: SectionResult<RequestAggregateSummary>;
  readonly endpoints: SectionResult<{
    readonly items: readonly RequestEndpointSummary[];
    readonly pagination: {
      readonly cursor?: string;
      readonly nextCursor?: string;
      readonly totalCount?: number;
      readonly totalCountStatus: string;
    };
  }>;
  readonly percentiles: SectionResult<Record<string, never>>;
}

export function fetchRequestEndpoints(
  scope: ProjectScope,
  query: {
    readonly timeRange: { readonly start: string; readonly end: string };
    readonly cursor?: string;
    readonly limit?: number;
  },
  options: FetchOptions = {},
): Promise<RequestEndpointsData> {
  const queryParams: Record<string, unknown> = { timeRange: query.timeRange };
  if (query.cursor !== undefined) queryParams.cursor = query.cursor;
  if (query.limit !== undefined) queryParams.limit = query.limit;
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
    query: queryParams,
  };
  return executeQuery<QueryResponse<RequestEndpointsData>>({
    operationId: OPERATION_ID_LIST_REQUEST_ENDPOINTS,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- DAT-17 Performance pages ----------------------------------------------------------------

export type PerformanceMetricName = 'lcp' | 'inp' | 'cls' | 'page_load';
export type PerformanceUnit = 'millisecond' | 'ratio';

export interface PerformanceMetricAggregate {
  readonly metricName: PerformanceMetricName;
  readonly unit: PerformanceUnit;
  readonly observedCount: number;
  readonly valueSum: number;
  readonly valueMax: number;
  readonly mean: number;
}

export interface PerformanceMetricSummary {
  readonly metrics: readonly PerformanceMetricAggregate[];
  readonly dataThrough?: string;
  readonly isPartial: boolean;
}

export interface PerformancePagesData {
  readonly metrics: SectionResult<PerformanceMetricSummary>;
  readonly pages: SectionResult<Record<string, never>>;
  readonly percentiles: SectionResult<Record<string, never>>;
}

export function fetchPerformancePages(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<PerformancePagesData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  if (options.timeRange !== undefined) input.query = { timeRange: options.timeRange };
  return executeQuery<QueryResponse<PerformancePagesData>>({
    operationId: OPERATION_ID_LIST_PERFORMANCE_PAGES,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}
