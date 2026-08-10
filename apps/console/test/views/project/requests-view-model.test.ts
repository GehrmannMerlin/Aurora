import { describe, expect, it } from 'vitest';
import {
  buildRequestsView,
  endpointsSectionToPage,
  mergeEndpointsPage,
} from '../../../src/views/project/requests-view-model.js';
import type { RequestEndpointSummary } from '../../../src/monitoring/queries.js';

const endpoint: RequestEndpointSummary = {
  endpointId: 'ep_1',
  method: 'GET',
  url: '/api/items',
  sampleCount: 10,
  outcomeCounts: [{ outcome: 'success', count: 9 }],
  isPartial: false,
  completeness: { source: 'samples', bounded: true },
};

describe('buildRequestsView', () => {
  it('keeps percentiles honestly unavailable and surfaces missing summary/endpoints', () => {
    const view = buildRequestsView({
      loading: false,
      error: null,
      summary: null,
      endpointsPage: null,
    });
    expect(view.percentiles).toMatchObject({ kind: 'unavailable' });
    expect(view.summary.kind).toBe('unavailable');
    expect(view.endpoints.kind).toBe('unavailable');
  });
});

describe('endpointsSectionToPage', () => {
  it('maps an available section to a page with cursor for load-more', () => {
    const page = endpointsSectionToPage({
      status: 'available',
      items: [endpoint],
      pagination: { nextCursor: 'c2', totalCount: 12, totalCountStatus: 'available' },
    });
    expect(page).toEqual({
      kind: 'available',
      data: {
        items: [endpoint],
        nextCursor: 'c2',
        totalCount: 12,
        totalCountStatus: 'available',
      },
    });
  });

  it('reports empty/unavailable instead of inventing zero', () => {
    expect(endpointsSectionToPage({ status: 'empty', reason: 'no endpoints' })).toEqual({
      kind: 'empty',
      reason: 'no endpoints',
    });
    expect(endpointsSectionToPage({ status: 'unavailable', reason: 'deferred' })).toEqual({
      kind: 'unavailable',
      reason: 'deferred',
    });
  });
});

describe('mergeEndpointsPage', () => {
  it('appends items and keeps the next cursor', () => {
    const first = endpointsSectionToPage({
      status: 'available',
      items: [endpoint],
      pagination: { nextCursor: 'c2', totalCountStatus: 'available' },
    });
    const second = endpointsSectionToPage({
      status: 'available',
      items: [{ ...endpoint, endpointId: 'ep_2' }],
      pagination: { totalCountStatus: 'available' },
    });
    const merged = mergeEndpointsPage([endpoint], second);
    expect(merged.items).toHaveLength(2);
    expect(merged.nextCursor).toBeNull();
    if (first.kind === 'available') {
      expect(first.data.items).toHaveLength(1);
    }
  });
});
