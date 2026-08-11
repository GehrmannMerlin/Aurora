import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspace } from '../src/check-workspace.js';
import { createWorkspaceFixture, type WorkspaceFixture, validManifest } from './fixtures.js';

let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

describe('Workspace dependency policy', () => {
  it('rejects an undeclared local package import', async () => {
    fixture = await createWorkspaceFixture([
      {
        directory: 'tooling/consumer',
        manifest: validManifest('@aurora/consumer'),
        files: { 'src/index.ts': "import '@aurora/provider';\n" },
      },
      { directory: 'tooling/provider', manifest: validManifest('@aurora/provider') },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'undeclared-dependency',
        dependency: '@aurora/provider',
        packageName: '@aurora/consumer',
      },
    ]);
  });

  it('rejects a cycle formed by declared local dependencies', async () => {
    const left = validManifest('@aurora/left');
    const right = validManifest('@aurora/right');
    left.dependencies = { '@aurora/right': 'workspace:*' };
    right.dependencies = { '@aurora/left': 'workspace:*' };
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/left', manifest: left },
      { directory: 'tooling/right', manifest: right },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.map(({ code }) => code)).toEqual([
      'dependency-cycle',
      'dependency-cycle',
    ]);
  });

  it('rejects private and unexported subpaths but accepts an exported subpath', async () => {
    const consumer = validManifest('@aurora/consumer');
    consumer.dependencies = { '@aurora/provider': 'workspace:*' };
    const provider = validManifest('@aurora/provider');
    provider.exports = { '.': './src/index.ts', './public': './src/public.ts' };
    fixture = await createWorkspaceFixture([
      {
        directory: 'tooling/consumer',
        manifest: consumer,
        files: {
          'src/index.ts': [
            "export { ok } from '@aurora/provider/public';",
            "export { hidden } from '@aurora/provider/internal/hidden';",
            "export { missing } from '@aurora/provider/missing';",
            '',
          ].join('\n'),
        },
      },
      { directory: 'tooling/provider', manifest: provider },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.map(({ code }) => code)).toEqual([
      'private-path-import',
      'private-path-import',
    ]);
    expect(result.violations.map(({ dependency }) => dependency)).toEqual([
      '@aurora/provider/internal/hidden',
      '@aurora/provider/missing',
    ]);
  });

  it('rejects every local dependency declared by a protocol package', async () => {
    const protocol = validManifest('@aurora/event-schema');
    protocol.aurora = { layer: 'protocol' };
    protocol.dependencies = { '@aurora/consumer': 'workspace:*' };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/event-schema', manifest: protocol },
      { directory: 'packages/consumer', manifest: validManifest('@aurora/consumer') },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'forbidden-layer-dependency',
        dependency: '@aurora/consumer',
        packageName: '@aurora/event-schema',
      },
    ]);
  });

  it('allows sdk-core to depend on protocol', async () => {
    const core = validManifest('@aurora/core');
    core.aurora = { layer: 'sdk-core' };
    core.dependencies = { '@aurora/event-schema': 'workspace:*' };
    const protocol = validManifest('@aurora/event-schema');
    protocol.aurora = { layer: 'protocol' };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/core', manifest: core },
      { directory: 'packages/event-schema', manifest: protocol },
    ]);

    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
  });

  it.each(['sdk-browser', 'sdk-plugin', 'framework', 'tooling'] as const)(
    'rejects an sdk-core dependency on %s',
    async (targetLayer) => {
      const core = validManifest('@aurora/core');
      core.aurora = { layer: 'sdk-core' };
      core.dependencies = { '@aurora/forbidden': 'workspace:*' };
      const forbidden = validManifest('@aurora/forbidden');
      forbidden.aurora = { layer: targetLayer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/core', manifest: core },
        { directory: 'packages/forbidden', manifest: forbidden },
      ]);

      const result = await checkWorkspace(fixture.rootDir);
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            packageName: '@aurora/core',
            code: 'forbidden-layer-dependency',
          }),
        ]),
      );
    },
  );

  it('allows a public self-reference without a self dependency and still rejects private self paths', async () => {
    const protocol = validManifest('@aurora/event-schema');
    protocol.aurora = { layer: 'protocol' };
    protocol.exports = { '.': './src/index.ts', './contract-testkit': './src/testkit.ts' };
    fixture = await createWorkspaceFixture([
      {
        directory: 'packages/event-schema',
        manifest: protocol,
        files: {
          'test/consumer.ts': [
            "import '@aurora/event-schema';",
            "import '@aurora/event-schema/contract-testkit';",
            "import '@aurora/event-schema/internal/parser';",
            '',
          ].join('\n'),
        },
      },
    ]);

    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'private-path-import',
        dependency: '@aurora/event-schema/internal/parser',
        packageName: '@aurora/event-schema',
      },
    ]);
  });

  it.each(['sdk-core', 'protocol'] as const)(
    'allows sdk-browser to depend on %s',
    async (layer) => {
      const browser = validManifest('@aurora/browser');
      browser.aurora = { layer: 'sdk-browser' };
      browser.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/browser', manifest: browser },
        { directory: 'packages/target', manifest: target },
      ]);
      await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
    },
  );

  it('allows the Core root but rejects a Browser import from Core src', async () => {
    const browser = validManifest('@aurora/browser');
    browser.aurora = { layer: 'sdk-browser' };
    browser.dependencies = { '@aurora/core': 'workspace:*' };
    const core = validManifest('@aurora/core');
    core.aurora = { layer: 'sdk-core' };
    fixture = await createWorkspaceFixture([
      {
        directory: 'packages/browser',
        manifest: browser,
        files: {
          'src/index.ts': [
            "import type { AuroraCore } from '@aurora/core';",
            "import type { CorePlugin } from '@aurora/core/src/plugin-contract.js';",
            'export type PublicCore = AuroraCore;',
            'export type PrivateCore = CorePlugin;',
            '',
          ].join('\n'),
        },
      },
      { directory: 'packages/core', manifest: core },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toMatchObject([
      {
        code: 'private-path-import',
        dependency: '@aurora/core/src/plugin-contract.js',
        packageName: '@aurora/browser',
      },
    ]);
  });

  it.each(['sdk-browser', 'sdk-plugin', 'framework', 'tooling'] as const)(
    'rejects sdk-browser dependency on %s',
    async (layer) => {
      const browser = validManifest('@aurora/browser');
      browser.aurora = { layer: 'sdk-browser' };
      browser.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/browser', manifest: browser },
        { directory: 'packages/target', manifest: target },
      ]);
      const result = await checkWorkspace(fixture.rootDir);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'forbidden-layer-dependency',
            packageName: '@aurora/browser',
          }),
        ]),
      );
    },
  );

  it.each(['sdk-core', 'sdk-browser', 'protocol'] as const)(
    'allows sdk-plugin to depend on %s',
    async (layer) => {
      const plugin = validManifest('@aurora/plugin-error');
      plugin.aurora = { layer: 'sdk-plugin' };
      plugin.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/plugin-error', manifest: plugin },
        { directory: 'packages/target', manifest: target },
      ]);
      await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
        ok: true,
        violations: [],
      });
    },
  );

  it.each(['sdk-plugin', 'framework', 'tooling'] as const)(
    'rejects sdk-plugin dependency on %s',
    async (layer) => {
      const plugin = validManifest('@aurora/plugin-error');
      plugin.aurora = { layer: 'sdk-plugin' };
      plugin.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/plugin-error', manifest: plugin },
        { directory: 'packages/target', manifest: target },
      ]);
      const result = await checkWorkspace(fixture.rootDir);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'forbidden-layer-dependency',
            packageName: '@aurora/plugin-error',
          }),
        ]),
      );
    },
  );

  it.each(['sdk-core', 'sdk-browser', 'protocol'] as const)(
    'allows sdk-framework to depend on %s',
    async (layer) => {
      const framework = validManifest('@aurora/plugin-vue');
      framework.aurora = { layer: 'sdk-framework' };
      framework.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/plugin-vue', manifest: framework },
        { directory: 'packages/target', manifest: target },
      ]);
      await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
        ok: true,
        violations: [],
      });
    },
  );

  it.each(['sdk-plugin', 'framework', 'tooling'] as const)(
    'rejects sdk-framework dependency on %s',
    async (layer) => {
      const framework = validManifest('@aurora/plugin-vue');
      framework.aurora = { layer: 'sdk-framework' };
      framework.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'packages/plugin-vue', manifest: framework },
        { directory: 'packages/target', manifest: target },
      ]);
      const result = await checkWorkspace(fixture.rootDir);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'forbidden-layer-dependency',
            packageName: '@aurora/plugin-vue',
          }),
        ]),
      );
    },
  );

  it.each(['sdk-core', 'sdk-browser', 'sdk-plugin', 'protocol'] as const)(
    'allows sdk-reference to depend on %s',
    async (layer) => {
      const reference = validManifest('@aurora/sdk-reference');
      reference.aurora = { layer: 'sdk-reference' };
      reference.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'examples/sdk-reference', manifest: reference },
        { directory: 'packages/target', manifest: target },
      ]);
      await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
        ok: true,
        violations: [],
      });
    },
  );

  it.each(['sdk-framework', 'service', 'data', 'tooling', 'console'] as const)(
    'rejects sdk-reference dependency on %s',
    async (layer) => {
      const reference = validManifest('@aurora/sdk-reference');
      reference.aurora = { layer: 'sdk-reference' };
      reference.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'examples/sdk-reference', manifest: reference },
        { directory: 'packages/target', manifest: target },
      ]);
      const result = await checkWorkspace(fixture.rootDir);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'forbidden-layer-dependency',
            packageName: '@aurora/sdk-reference',
          }),
        ]),
      );
    },
  );

  it.each(['sdk-framework'] as const)('rejects sdk-plugin dependency on %s', async (layer) => {
    const plugin = validManifest('@aurora/plugin-error');
    plugin.aurora = { layer: 'sdk-plugin' };
    plugin.dependencies = { '@aurora/target': 'workspace:*' };
    const target = validManifest('@aurora/target');
    target.aurora = { layer };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/plugin-error', manifest: plugin },
      { directory: 'packages/target', manifest: target },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-layer-dependency',
          packageName: '@aurora/plugin-error',
        }),
      ]),
    );
  });

  it.each(['service', 'data', 'protocol'] as const)(
    'allows tooling to depend on %s',
    async (layer) => {
      const tool = validManifest('@aurora/ingestion-benchmark');
      tool.aurora = { layer: 'tooling' };
      tool.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'tooling/ingestion-benchmark', manifest: tool },
        { directory: 'packages/target', manifest: target },
      ]);
      await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
        ok: true,
        violations: [],
      });
    },
  );

  it.each(['sdk-browser', 'sdk-plugin', 'sdk-core'] as const)(
    'rejects tooling dependency on %s',
    async (layer) => {
      const tool = validManifest('@aurora/ingestion-benchmark');
      tool.aurora = { layer: 'tooling' };
      tool.dependencies = { '@aurora/target': 'workspace:*' };
      const target = validManifest('@aurora/target');
      target.aurora = { layer };
      fixture = await createWorkspaceFixture([
        { directory: 'tooling/ingestion-benchmark', manifest: tool },
        { directory: 'packages/target', manifest: target },
      ]);
      const result = await checkWorkspace(fixture.rootDir);
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            packageName: '@aurora/ingestion-benchmark',
            code: 'forbidden-layer-dependency',
          }),
        ]),
      );
    },
  );

  it('allows a service package to depend on tooling', async () => {
    const service = validManifest('@aurora/ingestion-api');
    service.aurora = { layer: 'service' };
    service.dependencies = { '@aurora/ingestion-benchmark': 'workspace:*' };
    const tool = validManifest('@aurora/ingestion-benchmark');
    tool.aurora = { layer: 'tooling' };
    fixture = await createWorkspaceFixture([
      { directory: 'apps/ingestion-api', manifest: service },
      { directory: 'tooling/ingestion-benchmark', manifest: tool },
    ]);
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
      ok: true,
      violations: [],
    });
  });

  it('rejects plugin private imports and reverse dependencies', async () => {
    const plugin = validManifest('@aurora/plugin-error');
    plugin.aurora = { layer: 'sdk-plugin' };
    plugin.dependencies = { '@aurora/core': 'workspace:*' };
    const core = validManifest('@aurora/core');
    core.aurora = { layer: 'sdk-core' };
    core.dependencies = { '@aurora/plugin-error': 'workspace:*' };
    fixture = await createWorkspaceFixture([
      {
        directory: 'packages/plugin-error',
        manifest: plugin,
        files: {
          'src/index.ts': "import type { CorePlugin } from '@aurora/core/src/plugin-contract.js';",
        },
      },
      { directory: 'packages/core', manifest: core },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'private-path-import' }),
        expect.objectContaining({
          code: 'forbidden-layer-dependency',
          packageName: '@aurora/core',
        }),
        expect.objectContaining({ code: 'dependency-cycle' }),
      ]),
    );
  });

  it.each(['protocol'] as const)('allows a contract package to depend on %s', async (layer) => {
    const contract = validManifest('@aurora/platform-contract');
    contract.aurora = { layer: 'contract' };
    contract.dependencies = { '@aurora/target': 'workspace:*' };
    const target = validManifest('@aurora/target');
    target.aurora = { layer };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/platform-contract', manifest: contract },
      { directory: 'packages/target', manifest: target },
    ]);
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({ ok: true, violations: [] });
  });

  it('rejects a contract package depending on tooling', async () => {
    const contract = validManifest('@aurora/platform-contract');
    contract.aurora = { layer: 'contract' };
    contract.dependencies = { '@aurora/ingestion-benchmark': 'workspace:*' };
    const tool = validManifest('@aurora/ingestion-benchmark');
    tool.aurora = { layer: 'tooling' };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/platform-contract', manifest: contract },
      { directory: 'tooling/ingestion-benchmark', manifest: tool },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: '@aurora/platform-contract',
          code: 'forbidden-layer-dependency',
        }),
      ]),
    );
  });

  it('allows a console package to depend on contract', async () => {
    const consoleApp = validManifest('@aurora/console');
    consoleApp.aurora = { layer: 'console' };
    consoleApp.dependencies = { '@aurora/platform-contract': 'workspace:*' };
    const contract = validManifest('@aurora/platform-contract');
    contract.aurora = { layer: 'contract' };
    fixture = await createWorkspaceFixture([
      { directory: 'apps/console', manifest: consoleApp },
      { directory: 'packages/platform-contract', manifest: contract },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.filter((v) => v.code === 'forbidden-layer-dependency')).toHaveLength(
      0,
    );
  });

  it('allows a console package to depend on tooling', async () => {
    const consoleApp = validManifest('@aurora/console');
    consoleApp.aurora = { layer: 'console' };
    consoleApp.dependencies = { '@aurora/platform-contract-drift': 'workspace:*' };
    const tool = validManifest('@aurora/platform-contract-drift');
    tool.aurora = { layer: 'tooling' };
    fixture = await createWorkspaceFixture([
      { directory: 'apps/console', manifest: consoleApp },
      { directory: 'tooling/platform-contract-drift', manifest: tool },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.filter((v) => v.code === 'forbidden-layer-dependency')).toHaveLength(
      0,
    );
  });

  it('rejects a console package depending on data (no DB internals)', async () => {
    const consoleApp = validManifest('@aurora/console');
    consoleApp.aurora = { layer: 'console' };
    consoleApp.dependencies = { '@aurora/processing-store': 'workspace:*' };
    const store = validManifest('@aurora/processing-store');
    store.aurora = { layer: 'data' };
    fixture = await createWorkspaceFixture([
      { directory: 'apps/console', manifest: consoleApp },
      { directory: 'packages/processing-store', manifest: store },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations.some((v) => v.code === 'forbidden-layer-dependency')).toBe(true);
  });
});
