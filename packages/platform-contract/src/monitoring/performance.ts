import { arr, bool, enum_, num, obj, optional } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { timeRange, utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { sectionResult } from '../common/section.js';

export const OPERATION_ID_LIST_PERFORMANCE_PAGES = 'performanceListPages' as const;

export const performanceListPagesPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const performanceListPagesQuery = obj({
  // Optional RFC 3339 UTC window; the server applies the default last-24h window.
  timeRange: optional(timeRange),
});

// DAT-17 spec §5.3: project-level performance metric aggregates from performance_metric_buckets
// (ADR-021). `metricName`/`unit` are the event-schema public constants (lcp/inp/cls/page_load and
// millisecond/ratio). `mean` is the real value_sum/observed_count aggregate, not a percentile.
// The page dimension is not present in the data (no page key on the aggregate), and percentile raw
// material is deferred (ADR-021), so `pages`/`percentiles` are sectionResults that honestly report
// unavailable rather than forging a page list or fabricated percentiles.

const metricAggregate = obj({
  metricName: enum_(['lcp', 'inp', 'cls', 'page_load']),
  unit: enum_(['millisecond', 'ratio']),
  observedCount: num(0),
  valueSum: num(0),
  valueMax: num(0),
  mean: num(0),
});

const performanceMetricSummary = obj({
  metrics: arr(metricAggregate, 0, 16),
  dataThrough: optional(utcTimestamp),
  isPartial: bool(),
});

export const performanceListPagesResponse = queryResponse(
  obj({
    metrics: sectionResult(performanceMetricSummary),
    pages: sectionResult(obj({})),
    percentiles: sectionResult(obj({})),
  }),
);
