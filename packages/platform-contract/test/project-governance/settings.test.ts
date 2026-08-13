import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_SETTINGS_CREATE_ENVIRONMENT,
  OPERATION_ID_SETTINGS_GET,
  OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS,
  OPERATION_ID_SETTINGS_UPDATE,
  settingsCreateEnvironmentBody,
  settingsGetProjectResponse,
  settingsUpdateProjectBody,
} from '../../src/project-governance/settings.js';

describe('C15 settings contract', () => {
  it('freezes the operation ids', () => {
    expect(OPERATION_ID_SETTINGS_GET).toBe('settingsGetProject');
    expect(OPERATION_ID_SETTINGS_UPDATE).toBe('settingsUpdateProject');
    expect(OPERATION_ID_SETTINGS_LIST_ENVIRONMENTS).toBe('settingsListEnvironments');
    expect(OPERATION_ID_SETTINGS_CREATE_ENVIRONMENT).toBe('settingsCreateEnvironment');
  });

  it('accepts a project settings response with the lifecycle summary', () => {
    const result = settingsGetProjectResponse.zod.safeParse({
      data: {
        project: {
          projectId: 'prj_1',
          name: 'Web shop',
          frameworkType: 'vue',
          websiteUrl: 'https://example.invalid',
          lifecycle: { status: 'active' },
          resourceVersion: '1',
        },
      },
      meta: { requestId: 'req_1', readAt: '2026-08-12T00:00:00.000Z', normalizedQuery: {} },
      allowedActions: ['read', 'update'],
      navigationTargets: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown lifecycle status', () => {
    const result = settingsGetProjectResponse.zod.safeParse({
      data: {
        project: {
          projectId: 'prj_1',
          name: 'Web shop',
          frameworkType: 'vue',
          lifecycle: { status: 'exploded' },
          resourceVersion: '1',
        },
      },
      meta: { requestId: 'req_1', readAt: '2026-08-12T00:00:00.000Z', normalizedQuery: {} },
      allowedActions: ['read'],
      navigationTargets: [],
    });
    expect(result.success).toBe(false);
  });

  it('update body requires name + resourceVersion + idempotency key', () => {
    expect(
      settingsUpdateProjectBody.zod.safeParse({
        name: 'Web shop',
        resourceVersion: '1',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
    expect(
      settingsUpdateProjectBody.zod.safeParse({
        name: 'Web shop',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
    expect(
      settingsUpdateProjectBody.zod.safeParse({
        name: 'Web shop',
        websiteUrl: 'https://example.invalid',
        resourceVersion: '1',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('create-environment body takes a 1-32 char name', () => {
    expect(
      settingsCreateEnvironmentBody.zod.safeParse({
        name: 'staging',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
    expect(
      settingsCreateEnvironmentBody.zod.safeParse({ name: '', idempotencyKey: 'k'.repeat(36) })
        .success,
    ).toBe(false);
  });
});
