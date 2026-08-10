/**
 * C2 项目概览（`project.overview`）view-model（PLT-05）。
 *
 * 把多个公开 Query 的结果组合为概览的渲染状态。权威状态与原因只取
 * `diagnosticsGetDataStatus` 的服务端组合 `summary`；问题/请求/性能证据来自
 * DAT-15/16/17 的安全投影；后端未提供的能力（告警摘要、影响用户估算、环境/
 * 发布维度、Overview 复合状态）一律以 `unavailable`/缺省表达，不以零值或
 * “正常”代替。
 */
import type {
  ActionTarget,
  CredentialSafeStatus,
  DiagnosisData,
  DiagnosisSummary,
  QueryableEvidence,
  RecentEvidence,
} from '../../monitoring/diagnosis.js';
import type {
  IssueListData,
  PerformanceMetricSummary,
  PerformancePagesData,
  RequestAggregateSummary,
  RequestEndpointsData,
} from '../../monitoring/queries.js';
import { toSectionView, type SectionResult, type SectionView } from '../../monitoring/section.js';

export interface IssueCountEvidence {
  readonly totalCount: number;
  readonly totalCountStatus: 'available' | 'unavailable';
}

/** Reduce the DAT-15 issue-list section to a total-count evidence section. */
export function issueCountSection(
  list: IssueListData | null,
): SectionResult<IssueCountEvidence> | null {
  if (list === null) return null;
  const section = list.issues;
  const status = section.status;
  if (status === 'available') {
    return {
      status: 'available',
      data: {
        totalCount: section.pagination.totalCount,
        totalCountStatus:
          section.pagination.totalCountStatus === 'available' ? 'available' : 'unavailable',
      },
    };
  }
  if (status === 'empty') {
    return { status: 'empty', reason: section.reason ?? '窗口内没有问题' };
  }
  return { status: 'unavailable', reason: section.reason ?? '问题证据不可用' };
}

export interface OverviewState {
  readonly summary: SectionView<DiagnosisSummary>;
  readonly issues: SectionView<IssueCountEvidence>;
  readonly requests: SectionView<RequestAggregateSummary>;
  readonly performance: SectionView<PerformanceMetricSummary>;
  readonly recent: SectionView<RecentEvidence>;
  readonly credential: SectionView<CredentialSafeStatus>;
  readonly queryable: SectionView<QueryableEvidence>;
  readonly actions: readonly ActionTarget[];
}

export interface OverviewSource {
  readonly diagnosisLoading: boolean;
  readonly diagnosisError: string | null;
  readonly diagnosis: DiagnosisData | null;
  readonly issueListLoading: boolean;
  readonly issueListError: string | null;
  readonly issueList: IssueListData | null;
  readonly requestsLoading: boolean;
  readonly requestsError: string | null;
  readonly requests: RequestEndpointsData | null;
  readonly performanceLoading: boolean;
  readonly performanceError: string | null;
  readonly performance: PerformancePagesData | null;
}

export function buildOverviewState(source: OverviewSource): OverviewState {
  const diagnosis = source.diagnosis;
  return {
    summary: toSectionView({
      loading: source.diagnosisLoading,
      error: source.diagnosisError,
      section: diagnosis?.summary ?? null,
    }),
    issues: toSectionView({
      loading: source.issueListLoading,
      error: source.issueListError,
      section: issueCountSection(source.issueList),
    }),
    requests: toSectionView({
      loading: source.requestsLoading,
      error: source.requestsError,
      section: source.requests?.summary ?? null,
    }),
    performance: toSectionView({
      loading: source.performanceLoading,
      error: source.performanceError,
      section: source.performance?.metrics ?? null,
    }),
    recent: toSectionView({
      loading: source.diagnosisLoading,
      error: source.diagnosisError,
      section: diagnosis?.recent ?? null,
    }),
    credential: toSectionView({
      loading: source.diagnosisLoading,
      error: source.diagnosisError,
      section: diagnosis?.credential ?? null,
    }),
    queryable: toSectionView({
      loading: source.diagnosisLoading,
      error: source.diagnosisError,
      section: diagnosis?.queryable ?? null,
    }),
    actions: diagnosis?.actionTargets ?? [],
  };
}
