import { describe, expect, it } from 'vitest';
import {
  buildDataStatusState,
  type DataStatusSource,
} from '../../../src/views/project/data-status-view-model.js';
import type { DiagnosisData } from '../../../src/monitoring/diagnosis.js';

const AS_OF = '2026-08-10T00:00:00.000Z';

function diagnosisData(overrides: Partial<DiagnosisData> = {}): DiagnosisData {
  return {
    summary: { status: 'available', data: { status: 'processing', asOf: AS_OF } },
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

function source(overrides: Partial<DataStatusSource> = {}): DataStatusSource {
  return { loading: false, error: null, diagnosis: null, ...overrides };
}

describe('buildDataStatusState', () => {
  it('exposes all six sections from the diagnosis projection', () => {
    const state = buildDataStatusState(source({ diagnosis: diagnosisData() }));
    expect(state.summary).toEqual({
      kind: 'available',
      data: { status: 'processing', asOf: AS_OF },
    });
    expect(state.stages.kind).toBe('available');
    if (state.stages.kind === 'available') {
      expect(state.stages.data.received.count).toBe(5);
      expect(state.stages.data.processing.count).toBe(2);
      expect(state.stages.data.processed.count).toBe(3);
      // received ≠ processed ≠ queryable must not collapse.
      expect(state.stages.data.received.count).not.toBe(state.stages.data.processed.count);
    }
    expect(state.rejection).toMatchObject({ kind: 'unavailable' });
    expect(state.credential.kind).toBe('available');
    expect(state.queryable.kind).toBe('available');
    expect(state.actions.map((target) => target.routeId)).toEqual(['project.requests']);
  });

  it('propagates loading and error across every section', () => {
    const state = buildDataStatusState(source({ loading: true }));
    expect(state.summary.kind).toBe('loading');
    expect(state.stages.kind).toBe('loading');
    const failed = buildDataStatusState(source({ error: '加载失败' }));
    expect(failed.summary).toEqual({ kind: 'error', message: '加载失败' });
    expect(failed.queryable).toEqual({ kind: 'error', message: '加载失败' });
  });

  it('keeps missing sections honest (unavailable, never normal/zero)', () => {
    const state = buildDataStatusState(source());
    expect(state.summary.kind).toBe('unavailable');
    expect(state.stages.kind).toBe('unavailable');
    expect(state.credential.kind).toBe('unavailable');
    expect(state.actions).toEqual([]);
  });
});
