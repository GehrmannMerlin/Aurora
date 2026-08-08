import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('../../../', import.meta.url));

async function readRootFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('root Workspace contract', () => {
  it('pins Node and pnpm exactly', async () => {
    const parsed: unknown = JSON.parse(await readRootFile('package.json'));
    if (!isRecord(parsed)) throw new TypeError('Root package.json must be an object');
    const engines = isRecord(parsed.engines) ? parsed.engines : {};

    await expect(readRootFile('.node-version')).resolves.toBe('24.18.0\n');
    expect(parsed.packageManager).toBe('pnpm@11.17.0');
    expect(engines.node).toBe('>=24.18.0 <25');
    expect(rootDir.replace(/[/\\]$/, '').endsWith('Aurora')).toBe(true);
  });

  it('declares every stable root command', async () => {
    const parsed: unknown = JSON.parse(await readRootFile('package.json'));
    if (!isRecord(parsed) || !isRecord(parsed.scripts)) {
      throw new TypeError('Root package.json scripts must be an object');
    }
    expect(Object.keys(parsed.scripts).sort()).toEqual([
      'benchmark:ingestion:baseline',
      'benchmark:ingestion:smoke',
      'build',
      'check',
      'check:boundaries',
      'check:ci',
      'deploy:preview',
      'deploy:preview:rollback',
      'format:check',
      'lint',
      'openapi:check',
      'openapi:lint',
      'openapi:platform:lint',
      'platform-contract:drift',
      'platform-contract:generate',
      'test',
      'test:coverage',
      'typecheck',
    ]);
  });

  it('keeps Workspace and dependency execution policies explicit', async () => {
    const workspace = await readRootFile('pnpm-workspace.yaml');
    expect(workspace).toContain('nodeVersion: 24.18.0');
    expect(workspace).toContain('strictDepBuilds: true');
    expect(workspace).toContain('allowBuilds:\n  esbuild: true');
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds: true');
    for (const pattern of ['apps/*', 'packages/*', 'examples/*', 'tooling/*']) {
      expect(workspace).toContain(`- ${pattern}`);
    }
  });
});
