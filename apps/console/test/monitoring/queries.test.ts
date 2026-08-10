import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requestCache } from '../../src/api/cache.js';
import { handlerControls } from '../../src/mocks/handlers.js';
import { mockServer } from '../msw/server.js';
import {
  fetchDataStatus,
  fetchIssueDetail,
  fetchIssueList,
  fetchPerformancePages,
  fetchRequestEndpoints,
  type ProjectScope,
} from '../../src/monitoring/queries.js';

const scope: ProjectScope = { organizationId: 'org_test_1', projectId: 'prj_test_1' };

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});
beforeEach(() => {
  requestCache.clear();
  handlerControls.dataStatusRequests = 0;
  handlerControls.listIssuesRequests = 0;
  handlerControls.getIssueDetailRequests = 0;
  handlerControls.listRequestEndpointsRequests = 0;
  handlerControls.listPerformancePagesRequests = 0;
});
afterEach(() => {
  mockServer.resetHandlers();
});
afterAll(() => {
  mockServer.close();
});

describe('fetchDataStatus (DAT-20)', () => {
  it('returns the diagnosis projection with distinct received/processing/processed stages', async () => {
    const data = await fetchDataStatus(scope);
    expect(data.summary).toMatchObject({ status: 'available' });
    if (data.stages.status === 'available') {
      const stages = data.stages.data;
      // received ≠ processed ≠ queryable must never collapse into one number.
      expect(stages.received.count).toBe(5);
      expect(stages.processing.count).toBe(2);
      expect(stages.processed.count).toBe(3);
      expect(stages.received.count).not.toBe(stages.processed.count);
    }
    // Rejected batches are never persisted → the section honestly reports unavailable.
    expect(data.rejection).toMatchObject({ status: 'unavailable' });
    // Authorized navigation targets are returned and resolvable.
    expect(data.actionTargets.length).toBeGreaterThan(0);
    expect(handlerControls.dataStatusRequests).toBe(1);
  });

  it('serializes a nested timeRange with bracket notation', async () => {
    let captured: string | null = null;
    mockServer.use(
      http.get(
        '/api/platform/v1/organizations/:organizationId/projects/:projectId/data-status',
        ({ request }) => {
          captured = request.url;
          return HttpResponse.json(
            { data: {}, meta: {}, allowedActions: [], navigationTargets: [] },
            { status: 500 },
          );
        },
      ),
    );
    await fetchDataStatus(scope, {
      timeRange: { start: '2026-08-10T00:00:00.000Z', end: '2026-08-10T08:00:00.000Z' },
    }).catch(() => undefined);
    expect(captured).toContain('timeRange%5Bstart%5D=2026-08-10T00%3A00%3A00.000Z');
    expect(captured).toContain('timeRange%5Bend%5D=2026-08-10T08%3A00%3A00.000Z');
  });
});

describe('fetchIssueList (DAT-15)', () => {
  it('returns the issue list with honest totalCount and deferred dimensions', async () => {
    const data = await fetchIssueList(scope, {
      timeRange: { start: '2026-08-09T00:00:00.000Z', end: '2026-08-10T00:00:00.000Z' },
    });
    expect(data.issues.status).toBe('available');
    expect(data.issues.items.length).toBeGreaterThan(0);
    expect(data.issues.pagination.totalCountStatus).toBe('available');
    expect(data.environments).toMatchObject({ status: 'unavailable' });
    expect(data.releases).toMatchObject({ status: 'unavailable' });
    expect(handlerControls.listIssuesRequests).toBe(1);
  });

  it('passes filters and paging through the query string', async () => {
    let captured: string | null = null;
    mockServer.use(
      http.get(
        '/api/platform/v1/organizations/:organizationId/projects/:projectId/issues',
        ({ request }) => {
          captured = request.url;
          return HttpResponse.json(
            { data: {}, meta: {}, allowedActions: [], navigationTargets: [] },
            { status: 500 },
          );
        },
      ),
    );
    await fetchIssueList(scope, {
      timeRange: { start: '2026-08-09T00:00:00.000Z', end: '2026-08-10T00:00:00.000Z' },
      status: 'open',
      priority: 'high',
      cursor: 'abc',
      limit: 25,
    }).catch(() => undefined);
    expect(captured).toContain('status=open');
    expect(captured).toContain('priority=high');
    expect(captured).toContain('cursor=abc');
    expect(captured).toContain('limit=25');
  });
});

describe('fetchIssueDetail (DAT-15)', () => {
  it('returns issue, samples and activity projections', async () => {
    const data = await fetchIssueDetail(scope, 'issue_test_1');
    expect(data.issue).toMatchObject({ status: 'available' });
    expect(data.issue.data?.issueId).toBe('issue_test_1');
    expect(data.samples.items?.length).toBeGreaterThan(0);
    expect(handlerControls.getIssueDetailRequests).toBe(1);
  });
});

describe('fetchRequestEndpoints (DAT-16)', () => {
  it('returns the request aggregate summary and endpoint list', async () => {
    const data = await fetchRequestEndpoints(scope, {
      timeRange: { start: '2026-08-09T00:00:00.000Z', end: '2026-08-10T00:00:00.000Z' },
    });
    if (data.summary.status === 'available') {
      expect(data.summary.data.methods.length).toBeGreaterThan(0);
      expect(typeof data.summary.data.isPartial).toBe('boolean');
    }
    expect(data.percentiles).toMatchObject({ status: 'unavailable' });
    expect(handlerControls.listRequestEndpointsRequests).toBe(1);
  });
});

describe('fetchPerformancePages (DAT-17)', () => {
  it('returns performance metric aggregates with deferred pages/percentiles', async () => {
    const data = await fetchPerformancePages(scope);
    if (data.metrics.status === 'available') {
      const names = data.metrics.data.metrics.map((metric) => metric.metricName);
      expect(names).toEqual(expect.arrayContaining(['lcp', 'inp', 'cls', 'page_load']));
    }
    expect(data.pages).toMatchObject({ status: 'unavailable' });
    expect(data.percentiles).toMatchObject({ status: 'unavailable' });
    expect(handlerControls.listPerformancePagesRequests).toBe(1);
  });
});
