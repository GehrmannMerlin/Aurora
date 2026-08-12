import { describe, expect, it } from 'vitest';
import {
  buildLifecycleView,
  canArchive,
  canMoveToTrash,
  canRestoreFromArchive,
  lifecycleStatusLabel,
  trashNameMatches,
} from '../../../src/views/project/lifecycle-view-model.js';
import type { ProjectSettings } from '../../../src/monitoring/queries.js';

function projectWithStatus(status: string, name = 'Web shop'): ProjectSettings {
  return {
    projectId: 'prj_1',
    name,
    frameworkType: 'vue',
    lifecycle: { status },
    resourceVersion: '1',
  };
}

describe('buildLifecycleView', () => {
  it('unwraps the lifecycle-carrying project', () => {
    const view = buildLifecycleView({ loading: false, error: null, project: projectWithStatus('archived') });
    expect(view.project.kind).toBe('available');
    if (view.project.kind === 'available') {
      expect(view.project.data.lifecycle.status).toBe('archived');
    }
  });

  it('surfaces loading/error/unavailable honestly', () => {
    expect(buildLifecycleView({ loading: true, error: null, project: null }).project.kind).toBe('loading');
    expect(buildLifecycleView({ loading: false, error: '加载失败', project: null }).project.kind).toBe('error');
    expect(buildLifecycleView({ loading: false, error: null, project: null }).project.kind).toBe('unavailable');
  });
});

describe('lifecycle capabilities', () => {
  it('separates archive / restore-from-archive / move-to-trash by status', () => {
    expect(canArchive('active')).toBe(true);
    expect(canArchive('archived')).toBe(false);
    expect(canRestoreFromArchive('archived')).toBe(true);
    expect(canRestoreFromArchive('active')).toBe(false);
    expect(canMoveToTrash('active')).toBe(true);
    expect(canMoveToTrash('archived')).toBe(true);
    expect(canMoveToTrash('trash')).toBe(false);
  });
});

describe('trash confirmation', () => {
  it('requires the exact authoritative project name', () => {
    expect(trashNameMatches('Web shop', 'Web shop')).toBe(true);
    expect(trashNameMatches('web shop', 'Web shop')).toBe(false);
    expect(trashNameMatches('', 'Web shop')).toBe(false);
  });
});

describe('lifecycleStatusLabel', () => {
  it('maps PRD §17.1 statuses', () => {
    expect(lifecycleStatusLabel('active')).toBe('正常使用');
    expect(lifecycleStatusLabel('archived')).toBe('已归档');
    expect(lifecycleStatusLabel('trash')).toBe('回收站');
    expect(lifecycleStatusLabel('deleting')).toBe('正在删除');
  });
});
