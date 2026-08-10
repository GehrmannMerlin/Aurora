import { describe, expect, it } from 'vitest';
import {
  buildOverviewState,
  issueCountSection,
  type OverviewSource,
} from '../../../src/views/project/overview-view-model.js';
import type { DiagnosisData } from '../../../src/monitoring/diagnosis.js';
import type { IssueListData } from '../../../src/monitoring/queries.js';

const AS_OF = '2026-08-10T00:00:00.000Z';

function diagnosisData(overrides: Partial<DiagnosisData> = {}): DiagnosisData {
  return {
    summary: { status: 'available', data: { status: 'receiving', asOf: AS_OF } },
    stages: {
      status: 'available',
      data: {
        received: { count: 5, latestAt: '2026-08-10T08:59:00.000Z' },
        processing: { count: 2 },
        processed: { count: 3, latestAt: '2026-08-10T08:57:00.000Z' },
        deadLetter: { count: 0 },
      },
    },
    recent: {
      status: 'available',
      data: {
        latestReceivedAt: '2026-08-10T08:59:00.000Z',
        receivedCount: 5,
        latestProcessedAt: '2026-08-10T08:57:00.000Z',
        processedCount: 3,
        environmentBreakdown: {
          status: 'unavailable',
          reason: 'environment not persisted (deferred)',
        },
      },
    },
    rejection: { status: 'unavailable', reason: 'rejected batches are not persisted (deferred)' },
    credential: {
      status: 'available',
      data: { activeCount: 1, disabledCount: 0, revokedCount: 0 },
    },
    queryable: {
      status: 'available',
      data: { errorOccurrences: 3, requestMetricBuckets: 0, performanceMetricBuckets: 0 },
    },
    actionTargets: [
      {
        routeId: 'project.requests',
        pathParams: { organizationId: 'org_1', projectId: 'prj_1' },
        query: {},
      },
    ],
    ...overrides,
  };
}

function issueListData(status: string): IssueListData {
  return {
    issues: {
      status,
      items: [],
      pagination:
        status === 'available'
          ? { totalCount: 7, totalCountStatus: 'available' }
          : { totalCount: 0, totalCountStatus: 'unavailable' },
    },
    filters: { status: 'available' },
    summary: { status: 'available' },
    environments: { status: 'unavailable', reason: 'deferred' },
    releases: { status: 'unavailable', reason: 'deferred' },
  };
}

function source(overrides: Partial<OverviewSource> = {}): OverviewSource {
  return {
    diagnosisLoading: false,
    diagnosisError: null,
    diagnosis: null,
    issueListLoading: false,
    issueListError: null,
    issueList: null,
    requestsLoading: false,
    requestsError: null,
    requests: null,
    performanceLoading: false,
    performanceError: null,
    performance: null,
    ...overrides,
  };
}

describe('issueCountSection', () => {
  it('exposes the exact filtered totalCount when available', () => {
    const section = issueCountSection(issueListData('available'));
    expect(section).toEqual({
      status: 'available',
      data: { totalCount: 7, totalCountStatus: 'available' },
    });
  });

  it('surfaces empty honestly instead of zero', () => {
    const section = issueCountSection(issueListData('empty'));
    expect(section).toEqual({ status: 'empty', reason: '窗口内没有问题' });
  });

  it('reports unavailable (never a guessed number) for missing evidence', () => {
    expect(issueCountSection(null)).toBeNull();
    const section = issueCountSection(issueListData('unavailable'));
    expect(section?.status).toBe('unavailable');
  });
});

describe('buildOverviewState', () => {
  it('uses the server diagnosis summary as the authority status', () => {
    const state = buildOverviewState(
      source({ diagnosis: diagnosisData(), issueList: issueListData('available') }),
    );
    expect(state.summary).toEqual({
      kind: 'available',
      data: { status: 'receiving', asOf: AS_OF },
    });
    expect(state.issues).toEqual({
      kind: 'available',
      data: { totalCount: 7, totalCountStatus: 'available' },
    });
    expect(state.actions.map((target) => target.routeId)).toEqual(['project.requests']);
  });

  it('propagates loading and error states per section', () => {
    const state = buildOverviewState(
      source({
        diagnosisLoading: true,
        issueListError: '加载失败',
        requestsError: '网络错误',
      }),
    );
    expect(state.summary.kind).toBe('loading');
    expect(state.issues).toEqual({ kind: 'error', message: '加载失败' });
    expect(state.requests).toEqual({ kind: 'error', message: '网络错误' });
    expect(state.performance.kind).toBe('unavailable');
  });

  it('keeps unavailable sections honest (never normal/zero)', () => {
    const state = buildOverviewState(source());
    expect(state.summary.kind).toBe('unavailable');
    expect(state.issues.kind).toBe('unavailable');
    expect(state.requests.kind).toBe('unavailable');
    expect(state.actions).toEqual([]);
  });

  it('does not conflate rejected-batch and environment evidence with normal', () => {
    const state = buildOverviewState(
      source({
        diagnosis: diagnosisData({
          rejection: {
            status: 'unavailable',
            reason: 'rejected batches are not persisted (deferred)',
          },
        }),
      }),
    );
    // The rejection section is not part of the overview evidence, and the
    // diagnosis recent.environmentBreakdown must stay unavailable.
    expect(state.recent).toEqual(expect.objectContaining({ kind: 'available' }));
  });
});
