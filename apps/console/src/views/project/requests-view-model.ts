/**
 * C5 请求工作区（`project.requests`）view-model（PLT-06）。
 *
 * 把 `requestsListEndpoints`（DAT-16）的 summary/endpoints/percentiles 三区规范
 * 化为统一渲染状态；分页只追加不重建，缺失证据不以零值代替。
 */
import type { RequestAggregateSummary, RequestEndpointSummary } from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';

export interface EndpointPage {
  readonly items: readonly RequestEndpointSummary[];
  readonly nextCursor?: string;
  readonly totalCount?: number;
  readonly totalCountStatus: string;
}

export interface RequestsViewState {
  readonly summary: SectionView<RequestAggregateSummary>;
  readonly endpoints: SectionView<EndpointPage>;
  readonly percentiles: SectionView<Record<string, never>>;
}

export interface RequestsSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly summary: SectionView<RequestAggregateSummary> | null;
  readonly endpointsPage: SectionView<EndpointPage> | null;
}

export function buildRequestsView(source: RequestsSource): RequestsViewState {
  return {
    summary: source.summary ?? { kind: 'unavailable', reason: '请求证据不可用' },
    endpoints: source.endpointsPage ?? { kind: 'unavailable', reason: '接口列表不可用' },
    percentiles: { kind: 'unavailable', reason: 'percentile 原材料 deferred（ADR-021）' },
  };
}

/** Normalize a fetched endpoints section into a page view (with nextCursor for load-more). */
export function endpointsSectionToPage(section: {
  readonly status: string;
  readonly reason?: string;
  readonly items?: readonly RequestEndpointSummary[];
  readonly pagination?: {
    readonly nextCursor?: string;
    readonly totalCount?: number;
    readonly totalCountStatus?: string;
  };
}): SectionView<EndpointPage> {
  if (section.status === 'available') {
    const data: {
      items: readonly RequestEndpointSummary[];
      nextCursor?: string;
      totalCount?: number;
      totalCountStatus: string;
    } = {
      items: section.items ?? [],
      totalCountStatus: section.pagination?.totalCountStatus ?? 'unavailable',
    };
    if (section.pagination?.nextCursor !== undefined)
      data.nextCursor = section.pagination.nextCursor;
    if (section.pagination?.totalCount !== undefined)
      data.totalCount = section.pagination.totalCount;
    return { kind: 'available', data };
  }
  if (section.status === 'empty') {
    return { kind: 'empty', reason: section.reason ?? '窗口内没有接口数据' };
  }
  return { kind: 'unavailable', reason: section.reason ?? '接口列表不可用' };
}

/** Append the next page of endpoints to the running list (nextCursor drives load-more). */
export function mergeEndpointsPage(
  previous: readonly RequestEndpointSummary[],
  page: SectionView<EndpointPage>,
): { readonly items: readonly RequestEndpointSummary[]; readonly nextCursor: string | null } {
  if (page.kind === 'available') {
    return { items: [...previous, ...page.data.items], nextCursor: page.data.nextCursor ?? null };
  }
  return { items: previous, nextCursor: null };
}
