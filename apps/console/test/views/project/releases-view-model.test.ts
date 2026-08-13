import { describe, expect, it } from 'vitest';
import {
  buildReleasesView,
  releaseSectionToItems,
  releaseSourceLabel,
} from '../../../src/views/project/releases-view-model.js';
import type { ReleaseSummary } from '../../../src/monitoring/queries.js';

const release: ReleaseSummary = {
  releaseId: 'release_test_1',
  version: 'shop-web@1.4.3',
  source: 'source_map_upload',
  firstSeenAt: '2026-08-10T08:00:00.000Z',
  sourceMapFileCount: 2,
};

describe('buildReleasesView', () => {
  it('surfaces missing releases as unavailable and deployments as always-unavailable', () => {
    const view = buildReleasesView({ loading: false, error: null, releases: null });
    expect(view.list.kind).toBe('unavailable');
    expect(view.deployments).toMatchObject({ kind: 'unavailable' });
  });

  it('keeps deployments unavailable even when the list is available (no Deployment Query in v1)', () => {
    const view = buildReleasesView({
      loading: false,
      error: null,
      releases: {
        status: 'available',
        data: { items: [release] },
      },
    });
    expect(view.list).toEqual({ kind: 'available', data: [release] });
    expect(view.deployments.kind).toBe('unavailable');
  });

  it('prioritizes error over a missing section', () => {
    const view = buildReleasesView({ loading: false, error: '加载失败', releases: null });
    expect(view.list).toEqual({ kind: 'error', message: '加载失败' });
  });

  it('maps empty and forbidden honestly', () => {
    const empty = buildReleasesView({
      loading: false,
      error: null,
      releases: { status: 'empty', reason: 'no releases yet' },
    });
    expect(empty.list).toEqual({ kind: 'empty', reason: 'no releases yet' });

    const forbidden = buildReleasesView({
      loading: false,
      error: null,
      releases: { status: 'forbidden' },
    });
    expect(forbidden.list.kind).toBe('forbidden');
  });
});

describe('releaseSectionToItems', () => {
  it('unwraps an available section to the raw item list', () => {
    expect(releaseSectionToItems({ status: 'available', data: { items: [release] } })).toEqual({
      kind: 'available',
      data: [release],
    });
  });

  it('never invents zero for partial/stale/unavailable', () => {
    expect(releaseSectionToItems({ status: 'partial', data: { items: [] }, missing: 'x' })).toEqual(
      {
        kind: 'partial',
        data: [],
        missing: 'x',
      },
    );
    expect(releaseSectionToItems({ status: 'unavailable', reason: 'deferred' }).kind).toBe(
      'unavailable',
    );
  });
});

describe('releaseSourceLabel', () => {
  it('labels the only v1 release source and falls back for unknown values', () => {
    expect(releaseSourceLabel('source_map_upload')).toBe('Source Map 上传');
    expect(releaseSourceLabel('token')).toBe('token');
  });
});
