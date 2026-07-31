import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from '../src/check-workspace.js';
import { createWorkspaceFixture, type WorkspaceFixture, validManifest } from './fixtures.js';

let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

describe('Workspace manifest policy', () => {
  it('accepts an empty Workspace and a valid private tooling package', async () => {
    fixture = await createWorkspaceFixture([
      {
        directory: 'tooling/workspace-policy',
        manifest: validManifest('@aurora/workspace-policy'),
      },
    ]);

    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
  });

  it('reports invalid names and every missing required field', async () => {
    fixture = await createWorkspaceFixture([
      { directory: 'packages/bad', manifest: { name: 'bad name' } },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.ok).toBe(false);
    expect(result.violations.map(({ code }) => code)).toEqual([
      'invalid-package-name',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
      'missing-package-field',
    ]);
  });

  it('requires workspace protocol for local dependencies', async () => {
    const consumer = validManifest('@aurora/consumer');
    consumer.dependencies = { '@aurora/provider': '0.0.0' };
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/consumer', manifest: consumer },
      { directory: 'tooling/provider', manifest: validManifest('@aurora/provider') },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'non-workspace-local-dependency',
        packageName: '@aurora/consumer',
        dependency: '@aurora/provider',
      },
    ]);
  });
});
