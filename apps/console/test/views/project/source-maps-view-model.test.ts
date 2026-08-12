import { describe, expect, it } from 'vitest';
import {
  buildSourceMapsView,
  fileSectionToItems,
  reparseStateLabel,
  sourceMapStatusLabel,
} from '../../../src/views/project/source-maps-view-model.js';
import type { SourceMapFileSummary } from '../../../src/monitoring/queries.js';

const file: SourceMapFileSummary = {
  sourceMapFileId: 'sm_1',
  buildPath: '/assets/app.js',
  digestPrefix: 'a1b2c3d4',
  status: 'active',
  reparse: { state: 'queued' },
  uploadedAt: '2026-08-10T08:00:00.000Z',
  version: 1,
};

describe('buildSourceMapsView', () => {
  it('surfaces missing files as unavailable with idle phases', () => {
    const view = buildSourceMapsView({
      loading: false,
      error: null,
      files: null,
      upload: { kind: 'idle' },
      replace: { kind: 'idle' },
      reparse: { kind: 'idle' },
    });
    expect(view.files.kind).toBe('unavailable');
    expect(view.upload.kind).toBe('idle');
    expect(view.replace.kind).toBe('idle');
    expect(view.reparse.kind).toBe('idle');
  });

  it('unwraps an available file section and keeps the interaction phases', () => {
    const view = buildSourceMapsView({
      loading: false,
      error: null,
      files: { status: 'available', data: { items: [file] } },
      upload: { kind: 'succeeded', sourceMapFileId: 'sm_1' },
      replace: { kind: 'confirm', sourceMapFileId: 'sm_1', version: 2 },
      reparse: { kind: 'succeeded', taskCount: 3 },
    });
    expect(view.files).toEqual({ kind: 'available', data: [file] });
    expect(view.replace).toMatchObject({ kind: 'confirm', version: 2 });
  });

  it('prioritizes error and never invents zero for empty/unavailable', () => {
    const errorView = buildSourceMapsView({
      loading: false,
      error: '加载失败',
      files: null,
      upload: { kind: 'idle' },
      replace: { kind: 'idle' },
      reparse: { kind: 'idle' },
    });
    expect(errorView.files).toEqual({ kind: 'error', message: '加载失败' });

    const emptyView = buildSourceMapsView({
      loading: false,
      error: null,
      files: { status: 'empty', reason: 'no source map files for this release' },
      upload: { kind: 'idle' },
      replace: { kind: 'idle' },
      reparse: { kind: 'idle' },
    });
    expect(emptyView.files).toEqual({ kind: 'empty', reason: 'no source map files for this release' });
  });
});

describe('fileSectionToItems', () => {
  it('maps available/partial/stale/unavailable honestly', () => {
    expect(fileSectionToItems({ status: 'available', data: { items: [file] } })).toEqual({
      kind: 'available',
      data: [file],
    });
    expect(fileSectionToItems({ status: 'partial', data: { items: [file] }, missing: 'detail' })).toEqual({
      kind: 'partial',
      data: [file],
      missing: 'detail',
    });
    expect(fileSectionToItems({ status: 'unavailable', reason: 'deferred' }).kind).toBe(
      'unavailable',
    );
  });
});

describe('labels', () => {
  it('maps PRD §8.3.8 reparse states to Chinese labels', () => {
    expect(reparseStateLabel('queued')).toBe('等待处理');
    expect(reparseStateLabel('processing')).toBe('处理中');
    expect(reparseStateLabel('completed')).toBe('已完成');
    expect(reparseStateLabel('failed')).toBe('处理失败');
    expect(reparseStateLabel('unknown')).toBe('unknown');
  });

  it('maps file status labels', () => {
    expect(sourceMapStatusLabel('active')).toBe('当前有效');
    expect(sourceMapStatusLabel('replaced')).toBe('已替换');
  });
});
