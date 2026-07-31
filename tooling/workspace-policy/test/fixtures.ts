import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FixturePackage {
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, string>>;
}

export interface WorkspaceFixture {
  readonly rootDir: string;
  readonly dispose: () => Promise<void>;
}

export function validManifest(name: string): Record<string, unknown> {
  return {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    exports: { '.': './src/index.ts' },
    files: ['dist'],
    engines: { node: '>=24.18.0 <25' },
    scripts: { build: 'tsc -p tsconfig.build.json', test: 'vitest run' },
    aurora: { layer: 'tooling' },
  };
}

export async function createWorkspaceFixture(
  packages: readonly FixturePackage[],
): Promise<WorkspaceFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), 'aurora-workspace-policy-'));
  await writeFile(
    join(rootDir, 'pnpm-workspace.yaml'),
    ['packages:', '  - apps/*', '  - packages/*', '  - examples/*', '  - tooling/*', ''].join('\n'),
    'utf8',
  );

  for (const fixturePackage of packages) {
    const packageDir = join(rootDir, fixturePackage.directory);
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, 'package.json'),
      `${JSON.stringify(fixturePackage.manifest, null, 2)}\n`,
      'utf8',
    );
    for (const [relativePath, content] of Object.entries(fixturePackage.files ?? {})) {
      const filePath = join(packageDir, relativePath);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, content, 'utf8');
    }
  }

  return {
    rootDir,
    dispose: () => rm(rootDir, { force: true, recursive: true }),
  };
}
