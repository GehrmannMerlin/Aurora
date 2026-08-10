import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_LIST_PERFORMANCE_PAGES,
  performanceListPagesPathParams,
  performanceListPagesQuery,
  performanceListPagesResponse,
} from '../../src/monitoring/performance.js';

describe('performanceListPages contract', () => {
  it('pins the stable operation id', () => {
    expect(OPERATION_ID_LIST_PERFORMANCE_PAGES).toBe('performanceListPages');
  });

  it('requires organizationId and projectId path params', () => {
    const schema = performanceListPagesPathParams.zod;
    expect(
      schema.safeParse({ organizationId: 'a'.repeat(36), projectId: 'b'.repeat(36) }).success,
    ).toBe(true);
    expect(schema.safeParse({ organizationId: 'a'.repeat(36) }).success).toBe(false);
    expect(schema.safeParse({ projectId: 'b'.repeat(36) }).success).toBe(false);
  });

  it('pins the query shape with an optional timeRange', () => {
    const schema = performanceListPagesQuery.zod;
    // timeRange is optional: the server applies the default last-24h window.
    expect(schema.safeParse({}).success).toBe(true);
    expect(
      schema.safeParse({
        timeRange: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z' },
      }).success,
    ).toBe(true);
  });

  it('pins the response as a queryResponse with metrics/pages/percentiles sections', () => {
    const schema = performanceListPagesResponse.zod;
    // A valid projection: metrics available with one aggregate, pages/percentiles honestly
    // unavailable (no page dimension / no percentile raw material in performance data).
    const valid = schema.safeParse({
      data: {
        metrics: {
          status: 'available',
          data: {
            metrics: [
              {
                metricName: 'lcp',
                unit: 'millisecond',
                observedCount: 3,
                valueSum: 2400,
                valueMax: 900,
                mean: 800,
              },
            ],
            dataThrough: '2026-08-02T00:00:00.000Z',
            isPartial: false,
          },
        },
        pages: {
          status: 'unavailable',
          reason: 'page dimension not in performance data (deferred)',
        },
        percentiles: { status: 'unavailable', reason: 'percentiles deferred (ADR-021)' },
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
        normalizedQuery: {
          timeRange: '2026-08-01T00:00:00.000Z..2026-08-02T00:00:00.000Z',
        },
      },
      allowedActions: ['read'],
      navigationTargets: [
        {
          routeId: 'project.performance',
          pathParams: { organizationId: 'o', projectId: 'p' },
          query: {},
        },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it('accepts the empty/unavailable section variants for metrics', () => {
    const schema = performanceListPagesResponse.zod;
    const empty = schema.safeParse({
      data: {
        metrics: { status: 'empty', reason: 'no performance data in window' },
        pages: {
          status: 'unavailable',
          reason: 'page dimension not in performance data (deferred)',
        },
        percentiles: { status: 'unavailable', reason: 'percentiles deferred (ADR-021)' },
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
      },
      allowedActions: ['read'],
      navigationTargets: [],
    });
    expect(empty.success).toBe(true);
  });

  it('rejects unknown metricName and unit enum values (closed enums)', () => {
    const schema = performanceListPagesResponse.zod;
    const base = {
      data: {
        metrics: {
          status: 'available',
          data: {
            metrics: [
              {
                metricName: 'lcp',
                unit: 'millisecond',
                observedCount: 1,
                valueSum: 1,
                valueMax: 1,
                mean: 1,
              },
            ],
            dataThrough: '2026-08-02T00:00:00.000Z',
            isPartial: false,
          },
        },
        pages: {
          status: 'unavailable',
          reason: 'page dimension not in performance data (deferred)',
        },
        percentiles: { status: 'unavailable', reason: 'percentiles deferred (ADR-021)' },
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
      },
      allowedActions: ['read'],
      navigationTargets: [],
    };

    // Every legal metricName/unit parses; the four-value enum is closed.
    for (const metricName of ['lcp', 'inp', 'cls', 'page_load']) {
      const res = schema.safeParse({
        ...base,
        data: {
          ...base.data,
          metrics: {
            ...base.data.metrics,
            data: {
              ...base.data.metrics.data,
              metrics: [{ ...base.data.metrics.data.metrics[0], metricName }],
            },
          },
        },
      });
      expect(res.success, metricName).toBe(true);
    }
    for (const unit of ['millisecond', 'ratio']) {
      const res = schema.safeParse({
        ...base,
        data: {
          ...base.data,
          metrics: {
            ...base.data.metrics,
            data: {
              ...base.data.metrics.data,
              metrics: [{ ...base.data.metrics.data.metrics[0], unit }],
            },
          },
        },
      });
      expect(res.success, unit).toBe(true);
    }

    // A value outside the closed metricName enum is rejected.
    const badMetric = schema.safeParse({
      ...base,
      data: {
        ...base.data,
        metrics: {
          ...base.data.metrics,
          data: {
            ...base.data.metrics.data,
            metrics: [{ ...base.data.metrics.data.metrics[0], metricName: 'bogus' }],
          },
        },
      },
    });
    expect(badMetric.success).toBe(false);

    // A value outside the closed unit enum is rejected.
    const badUnit = schema.safeParse({
      ...base,
      data: {
        ...base.data,
        metrics: {
          ...base.data.metrics,
          data: {
            ...base.data.metrics.data,
            metrics: [{ ...base.data.metrics.data.metrics[0], unit: 'seconds' }],
          },
        },
      },
    });
    expect(badUnit.success).toBe(false);
  });
});
