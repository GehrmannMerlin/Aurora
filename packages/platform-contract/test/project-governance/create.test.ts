import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CREATE_PROJECT,
  organizationCreateProjectRequest,
  organizationCreateProjectResponse,
} from '../../src/project-governance/create.js';

const validResponse = {
  projectId: 'prj_123',
  clientKeyPublicIdentifier: 'aurora_key_abcdefgh',
  clientKey: 'aurora_ingest_AAAAAAAAAAAAAAAAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  defaultEnvironment: 'production',
  onboardingStatus: 'not_started',
  navigationTargets: [],
};

describe('organizationCreateProject contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_CREATE_PROJECT).toBe('organizationCreateProject');
  });

  it('accepts a valid create request', () => {
    expect(
      organizationCreateProjectRequest.zod.safeParse({
        name: 'Web',
        frameworkType: 'vue',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('accepts a websiteUrl', () => {
    expect(
      organizationCreateProjectRequest.zod.safeParse({
        name: 'Web',
        frameworkType: 'react',
        websiteUrl: 'https://example.invalid',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing name', () => {
    expect(
      organizationCreateProjectRequest.zod.safeParse({
        frameworkType: 'vue',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown frameworkType', () => {
    expect(
      organizationCreateProjectRequest.zod.safeParse({
        name: 'Web',
        frameworkType: 'svelte',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
  });

  it('rejects an undeclared field (closed object)', () => {
    expect(
      organizationCreateProjectRequest.zod.safeParse({
        name: 'Web',
        frameworkType: 'vue',
        idempotencyKey: 'k'.repeat(36),
        clientKeySecret: 'x',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid create response', () => {
    expect(organizationCreateProjectResponse.zod.safeParse(validResponse).success).toBe(true);
  });

  it('rejects an undeclared second secret field', () => {
    expect(
      organizationCreateProjectResponse.zod.safeParse({
        ...validResponse,
        clientKeySecret: 'aurora_key_secret_value',
      }).success,
    ).toBe(false);
  });
});
