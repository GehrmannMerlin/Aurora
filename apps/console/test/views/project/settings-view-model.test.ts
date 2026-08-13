import { describe, expect, it } from 'vitest';
import {
  buildSettingsView,
  environmentSectionToItems,
  frameworkLabel,
} from '../../../src/views/project/settings-view-model.js';
import type { ProjectSettings } from '../../../src/monitoring/queries.js';

const project: ProjectSettings = {
  projectId: 'prj_1',
  name: 'Web shop',
  frameworkType: 'vue',
  lifecycle: { status: 'active' },
  resourceVersion: '1',
};

describe('buildSettingsView', () => {
  it('unwraps project + environments and keeps them independent', () => {
    const view = buildSettingsView({
      loading: false,
      error: null,
      project,
      environments: {
        status: 'available',
        data: {
          items: [
            {
              environmentId: 'env_1',
              name: 'production',
              isDefault: 'true',
              createdAt: '2026-08-12T00:00:00.000Z',
            },
          ],
        },
      },
    });
    expect(view.project.kind).toBe('available');
    expect(view.environments.kind).toBe('available');
  });

  it('surfaces a missing environment section as unavailable without failing the project', () => {
    const view = buildSettingsView({ loading: false, error: null, project, environments: null });
    expect(view.project.kind).toBe('available');
    expect(view.environments.kind).toBe('unavailable');
  });
});

describe('environmentSectionToItems', () => {
  it('maps empty/unavailable honestly', () => {
    expect(environmentSectionToItems({ status: 'empty', reason: 'none' }).kind).toBe('empty');
    expect(environmentSectionToItems({ status: 'unavailable', reason: 'deferred' }).kind).toBe(
      'unavailable',
    );
  });
});

describe('frameworkLabel', () => {
  it('labels the four first-version framework types', () => {
    expect(frameworkLabel('vue')).toBe('Vue');
    expect(frameworkLabel('react')).toBe('React');
    expect(frameworkLabel('javascript')).toBe('JavaScript');
    expect(frameworkLabel('other')).toBe('other');
  });
});
