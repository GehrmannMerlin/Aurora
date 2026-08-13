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
  OPERATION_ID_ACCESS_LIST,
  OPERATION_ID_ALERTS_GET_CAPABILITY,
  OPERATION_ID_ALERTS_GET_INSTANCE,
  OPERATION_ID_ALERTS_LIST,
  OPERATION_ID_CREDENTIALS_LIST,
  OPERATION_ID_GET_DATA_STATUS,
  OPERATION_ID_GET_ISSUE_DETAIL,
  OPERATION_ID_LIST_ISSUES,
  OPERATION_ID_LIST_PERFORMANCE_PAGES,
  OPERATION_ID_LIST_REQUEST_ENDPOINTS,
  OPERATION_ID_NOTIFICATIONS_LIST,
  OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY,
  OPERATION_ID_POLICY_GET_DEFAULT,
  OPERATION_ID_POLICY_GET_ORGANIZATION,
  OPERATION_ID_POLICY_GET_PROJECT,
  OPERATION_ID_POLICY_TARGET_SEARCH,
  OPERATION_ID_RELEASES_LIST,
  OPERATION_ID_SETTINGS_GET,
  OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS,
  OPERATION_ID_SOURCE_MAPS_LIST,
  OPERATION_ID_GET_USAGE_SUMMARY,
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

// --- DAT-18 Releases (C8) / Source Map files (C9) ---------------------------------------------

/**
 * A release identity is created by an authorized source-map upload (DAT-18 spec:
 * upload upserts the release by version). The deployment record dimension is NOT
 * part of the v1 contract, so C8 shows releases but never fabricates deployments.
 */
export interface ReleaseSummary {
  readonly releaseId: string;
  readonly version: string;
  readonly source: string;
  readonly firstSeenAt: string;
  readonly sourceMapFileCount: number;
}

/** `releasesListReleases.data` is itself the section (DAT-18 handler unwraps items). */
export type ReleaseListSection = SectionResult<{ readonly items: readonly ReleaseSummary[] }>;

export function fetchReleases(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<ReleaseListSection> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<ReleaseListSection>>({
    operationId: OPERATION_ID_RELEASES_LIST,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

/** C9 current-effective Source Map file list for a release (strict project+release+path). */
export interface SourceMapFileSummary {
  readonly sourceMapFileId: string;
  readonly buildPath: string;
  readonly digestPrefix: string;
  readonly status: string;
  readonly reparse: {
    readonly state: string;
    readonly processedCount?: number;
    readonly totalCount?: number;
    readonly updatedAt?: string;
  };
  readonly uploadedAt: string;
  readonly replacedAt?: string;
  readonly version: number;
}

/** `sourceMapsListFiles.data` is itself the section (DAT-18 handler unwraps items). */
export type SourceMapFilesSection = SectionResult<{
  readonly items: readonly SourceMapFileSummary[];
}>;

export function fetchSourceMapFiles(
  scope: ProjectScope,
  releaseId: string,
  options: FetchOptions = {},
): Promise<SourceMapFilesSection> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId, releaseId },
  };
  return executeQuery<QueryResponse<SourceMapFilesSection>>({
    operationId: OPERATION_ID_SOURCE_MAPS_LIST,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- DAT-19 Alerts (C10/C11/C12) -----------------------------------------------------------------

export interface AlertRuleSummary {
  readonly ruleId: string;
  readonly name?: string;
  readonly metric: string;
  readonly windowMinutes: number;
  readonly triggerThreshold: number;
  readonly recoveryThreshold: number;
  readonly recipientAccountIds: readonly string[];
  readonly evaluation: {
    readonly state: string;
    readonly observedValue?: number;
    readonly sinceAt?: string;
    readonly lastEvaluatedAt?: string;
    readonly pauseReason?: string;
  };
  readonly version: number;
}

export interface AlertInstanceSummary {
  readonly instanceId: string;
  readonly ruleId: string;
  readonly ruleName?: string;
  readonly metric: string;
  readonly state: string;
  readonly triggeredAt: string;
  readonly recoveredAt?: string;
  readonly pauseReason?: string;
}

export interface AlertsData {
  readonly rules: SectionResult<{ readonly items: readonly AlertRuleSummary[] }>;
  readonly instances: SectionResult<{
    readonly items: readonly AlertInstanceSummary[];
    readonly count: number;
    readonly totalCountStatus: string;
  }>;
}

export function fetchAlertsList(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<AlertsData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<AlertsData>>({
    operationId: OPERATION_ID_ALERTS_LIST,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

export interface AlertMetricCapability {
  readonly metric: string;
  readonly displayName: string;
  readonly unit: string;
  readonly direction: string;
  readonly isRatio: boolean;
  readonly minSamplesRequired: boolean;
  readonly filterDimensions: readonly string[];
}

export interface AlertFilterDimensionStatus {
  readonly id: string;
  readonly available: boolean;
  readonly reason?: string;
}

export interface AlertRecipient {
  readonly accountId: string;
  readonly maskedEmail: string;
}

export interface AlertCapabilityData {
  readonly metrics: readonly AlertMetricCapability[];
  readonly windowsMinutes: readonly number[];
  readonly triggerDurationsMinutes: readonly number[];
  readonly cooldownsMinutes: readonly number[];
  readonly filterDimensions: readonly AlertFilterDimensionStatus[];
  readonly recipients: readonly AlertRecipient[];
}

export function fetchAlertsCapability(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<AlertCapabilityData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<AlertCapabilityData>>({
    operationId: OPERATION_ID_ALERTS_GET_CAPABILITY,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

export interface AlertInstanceEvidence {
  readonly evaluatedAt: string;
  readonly windowStartAt: string;
  readonly windowEndAt: string;
  readonly observedValue?: number;
  readonly numerator?: number;
  readonly denominator?: number;
  readonly sampleCount?: number;
  readonly minSampleRequirement?: number;
  readonly watermarkAt?: string;
  readonly completeness: string;
  readonly pauseReason?: string;
  readonly appliedFilters: {
    readonly environment: readonly string[];
    readonly release: readonly string[];
    readonly pageOrEndpoint: readonly string[];
    readonly errorSeverity: readonly string[];
  };
}

export interface AlertInstanceTransition {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface AlertInstanceDetailData {
  readonly instance: {
    readonly instanceId: string;
    readonly ruleId: string;
    readonly ruleName?: string;
    readonly metric: string;
    readonly state: string;
    readonly directReason: string;
    readonly triggeredAt: string;
    readonly recoveredAt?: string;
    readonly pauseReason?: string;
  };
  readonly ruleSnapshot: {
    readonly name?: string;
    readonly metric: string;
    readonly filters: {
      readonly environment: readonly string[];
      readonly release: readonly string[];
      readonly pageOrEndpoint: readonly string[];
      readonly errorSeverity: readonly string[];
    };
    readonly windowMinutes: number;
    readonly triggerThreshold: number;
    readonly triggerDurationMinutes: number;
    readonly recoveryThreshold: number;
    readonly recoveryDurationMinutes: number;
    readonly minSampleCount?: number;
    readonly cooldownMinutes: number;
  };
  readonly evidence: AlertInstanceEvidence;
  readonly transitions: readonly AlertInstanceTransition[];
}

export function fetchAlertInstanceDetail(
  scope: ProjectScope,
  instanceId: string,
  options: FetchOptions = {},
): Promise<AlertInstanceDetailData> {
  const input: PlatformRequestInput = {
    pathParams: {
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      instanceId,
    },
  };
  return executeQuery<QueryResponse<AlertInstanceDetailData>>({
    operationId: OPERATION_ID_ALERTS_GET_INSTANCE,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- C13 Effective project access (PLT-08) --------------------------------------------------------

export type EffectiveMemberSource = 'org_inherited' | 'project_member';

export interface EffectiveMember {
  readonly accountId: string;
  readonly maskedEmail: string;
  readonly effectiveRole: string;
  readonly sources: readonly EffectiveMemberSource[];
  readonly projectRole?: string;
  readonly allowedActions: readonly string[];
}

export interface EffectiveMembersData {
  readonly members: SectionResult<{ readonly items: readonly EffectiveMember[] }>;
}

export function fetchEffectiveMembers(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<EffectiveMembersData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<EffectiveMembersData>>({
    operationId: OPERATION_ID_ACCESS_LIST,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- C14 Client keys (PLT-08) ----------------------------------------------------------------------

export interface ClientKeyMetadata {
  readonly credentialId: string;
  readonly keyId: string;
  readonly status: string;
  readonly allowNonBrowser: boolean;
  readonly expiresAt?: string;
  readonly origins: readonly string[];
  readonly environments: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClientKeysData {
  readonly keys: SectionResult<{ readonly items: readonly ClientKeyMetadata[] }>;
}

export function fetchClientKeys(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<ClientKeysData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<ClientKeysData>>({
    operationId: OPERATION_ID_CREDENTIALS_LIST,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- C15 Project settings + environments (PLT-08) --------------------------------------------------

export interface ProjectSettings {
  readonly projectId: string;
  readonly name: string;
  readonly frameworkType: string;
  readonly websiteUrl?: string;
  readonly lifecycle: {
    readonly status: string;
    readonly archivedAt?: string;
    readonly trashedAt?: string;
    readonly recoverableUntil?: string;
  };
  readonly resourceVersion: string;
}

export interface ProjectSettingsData {
  readonly project: ProjectSettings;
}

export function fetchProjectSettings(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<ProjectSettingsData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<ProjectSettingsData>>({
    operationId: OPERATION_ID_SETTINGS_GET,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

export interface ProjectEnvironment {
  readonly environmentId: string;
  readonly name: string;
  readonly isDefault: string;
  readonly createdAt: string;
}

export interface ProjectEnvironmentsData {
  readonly environments: SectionResult<{ readonly items: readonly ProjectEnvironment[] }>;
}

export function fetchProjectEnvironments(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<ProjectEnvironmentsData> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
  };
  return executeQuery<QueryResponse<ProjectEnvironmentsData>>({
    operationId: OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS,
    input,
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- PLT-09 D1 Notifications (account-scoped) ----------------------------------------------------

/** A constrained navigation target (never an arbitrary URL). */
export interface NotificationTarget {
  readonly routeId: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface NotificationItem {
  readonly notificationId: string;
  readonly type: string;
  readonly title: string;
  readonly summary?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly occurredAt: string;
  readonly readAt?: string;
  readonly target: NotificationTarget;
}

export interface NotificationsListData {
  /** Flat section status from the contract (available/empty/unavailable). */
  readonly status: string;
  readonly reason?: string;
  readonly items: readonly NotificationItem[];
  readonly pagination: {
    readonly cursor?: string;
    readonly nextCursor?: string;
    readonly totalCount?: number;
    readonly totalCountStatus: string;
  };
}

export interface NotificationsData {
  readonly notifications: NotificationsListData;
  readonly unreadCount: {
    readonly value?: number;
    readonly status: 'available' | 'unavailable';
  };
}

export interface NotificationsQueryInput {
  readonly readState?: 'all' | 'unread';
  readonly cursor?: string;
  readonly limit?: number;
}

/** Account-level notifications list + unread count (D1). Scope is `account`. */
export function fetchNotifications(
  query: NotificationsQueryInput,
  options: FetchOptions = {},
): Promise<NotificationsData> {
  const queryParams: Record<string, unknown> = {};
  if (query.readState !== undefined) queryParams.readState = query.readState;
  if (query.cursor !== undefined) queryParams.cursor = query.cursor;
  if (query.limit !== undefined) queryParams.limit = query.limit;
  const input: PlatformRequestInput =
    Object.keys(queryParams).length === 0 ? {} : { query: queryParams };
  return executeQuery<QueryResponse<NotificationsData>>({
    operationId: OPERATION_ID_NOTIFICATIONS_LIST,
    input,
    scope: { type: 'account' },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

export interface UsageSummaryData {
  readonly organizationId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly acceptedEvents: number;
  readonly processedEvents: number;
  readonly quotaAcceptedEvents: number;
  readonly ratio: number;
  readonly stage: 'normal' | 'near-limit' | 'degraded' | 'hard-limit';
  readonly note?: string;
}

export function fetchUsageSummary(
  organizationId: string,
  options: FetchOptions = {},
): Promise<UsageSummaryData> {
  return executeQuery<QueryResponse<UsageSummaryData>>({
    operationId: OPERATION_ID_GET_USAGE_SUMMARY,
    input: { pathParams: { organizationId } },
    scope: { type: 'organization', id: organizationId },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

// --- PLT-10c D2 Platform resource policies (account-scoped, platform-admin gated) --------------

/**
 * The five PRD §15.8 protective fields shared by the platform default and
 * organization overrides. Mirrors the Plan B contract `policyFields`.
 */
export interface PlatformPolicyFields {
  readonly defaultPeriodQuota: number;
  readonly warningRatio: number;
  readonly hardLimit: number;
  readonly degradationEnabled: boolean;
  readonly highValueRetentionDays: number;
}

/**
 * First version has no data-plane consumer, so propagation is always `unknown`
 * (the page must never claim the policy has already taken effect).
 */
export interface PolicyPropagation {
  readonly status: 'unknown';
  readonly reason: string;
}

/** Effective policy projection for org-scope targets (default / org effective). */
export interface PlatformPolicyProjection {
  readonly configured: PlatformPolicyFields;
  readonly source: string;
  readonly effective: PlatformPolicyFields;
  readonly version: number;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
  readonly propagation: PolicyPropagation;
}

/**
 * Project effective-policy projection: the project's own `resourceLimit` override
 * (`configured`) plus the full computed effective policy. `resourceLimit` is
 * optional in both — a project with no limit row reports none (ADR-035).
 */
export interface ProjectPolicyProjection {
  readonly configured: { readonly resourceLimit?: number };
  readonly source: string;
  readonly effective: PlatformPolicyFields & { readonly resourceLimit?: number };
  readonly version: number;
  readonly updatedAt?: string;
  readonly updatedBy?: string;
  readonly propagation: PolicyPropagation;
}

export interface PolicyTargetOrganization {
  readonly organizationId: string;
  readonly name: string;
}

export interface PolicyTargetProject {
  readonly projectId: string;
  readonly organizationId: string;
  readonly name: string;
}

export interface PolicyTargetSearchResult {
  readonly organizations: readonly PolicyTargetOrganization[];
  readonly projects: readonly PolicyTargetProject[];
  readonly pagination: {
    readonly cursor?: string;
    readonly nextCursor?: string;
    readonly totalCount?: number;
    readonly totalCountStatus: string;
  };
}

export interface PlatformAdminCapability {
  readonly hasCapability: boolean;
}

/** Plain `{ data: T }` envelope for non-queryResponse operations (capability). */
interface PlainDataResponse<T> {
  readonly data: T;
}

/**
 * Resolve whether the current account holds platform admin capability (D2).
 * Session + platform-admin gated; the server resolves capability from the
 * session account, so the scope is `account`.
 */
export function fetchPlatformAdminCapability(
  options: FetchOptions = {},
): Promise<PlatformAdminCapability> {
  return executeQuery<PlainDataResponse<PlatformAdminCapability>>({
    operationId: OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY,
    input: {},
    scope: { type: 'account' },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

export interface PolicyTargetSearchInput {
  readonly q?: string;
  readonly limit?: number;
}

/**
 * Search policy targets (organizations and projects) by name for the D2 target
 * picker. Server-authorised: only organization-kind orgs and active/archived
 * projects are returned; never loads a full directory.
 */
export function fetchPolicyTargetSearch(
  query: PolicyTargetSearchInput,
  options: FetchOptions = {},
): Promise<PolicyTargetSearchResult> {
  const queryParams: Record<string, unknown> = {};
  if (query.q !== undefined) queryParams.q = query.q;
  if (query.limit !== undefined) queryParams.limit = query.limit;
  const input: PlatformRequestInput =
    Object.keys(queryParams).length === 0 ? {} : { query: queryParams };
  return executeQuery<QueryResponse<PolicyTargetSearchResult>>({
    operationId: OPERATION_ID_POLICY_TARGET_SEARCH,
    input,
    scope: { type: 'account' },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}

/**
 * The three effective-policy GETs return a `queryResponse` whose `data` field is
 * itself `{ data: projection }` (Plan B contract wraps the projection), so these
 * wrappers unwrap `response.data.data` to hand views the projection directly.
 */
export function fetchPolicyGetDefault(
  options: FetchOptions = {},
): Promise<PlatformPolicyProjection> {
  return executeQuery<QueryResponse<{ data: PlatformPolicyProjection }>>({
    operationId: OPERATION_ID_POLICY_GET_DEFAULT,
    input: {},
    scope: { type: 'account' },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data.data);
}

export function fetchPolicyGetOrganizationEffective(
  organizationId: string,
  options: FetchOptions = {},
): Promise<PlatformPolicyProjection> {
  const input: PlatformRequestInput = {
    pathParams: { organizationId },
  };
  return executeQuery<QueryResponse<{ data: PlatformPolicyProjection }>>({
    operationId: OPERATION_ID_POLICY_GET_ORGANIZATION,
    input,
    scope: { type: 'account' },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data.data);
}

export function fetchPolicyGetProjectEffective(
  projectId: string,
  options: FetchOptions = {},
): Promise<ProjectPolicyProjection> {
  const input: PlatformRequestInput = {
    pathParams: { projectId },
  };
  return executeQuery<QueryResponse<{ data: ProjectPolicyProjection }>>({
    operationId: OPERATION_ID_POLICY_GET_PROJECT,
    input,
    scope: { type: 'account' },
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data.data);
}
