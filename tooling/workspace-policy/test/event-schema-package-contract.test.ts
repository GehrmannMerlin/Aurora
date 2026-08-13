import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface EventSchemaManifest {
  readonly name?: unknown;
  readonly private?: unknown;
  readonly version?: unknown;
  readonly type?: unknown;
  readonly exports?: unknown;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly scripts?: unknown;
  readonly aurora?: unknown;
  readonly publishConfig?: unknown;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function readManifest(): Promise<EventSchemaManifest> {
  const text = await readFile(
    new URL('../../../packages/event-schema/package.json', import.meta.url),
    'utf8',
  );
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new TypeError('event-schema package.json must be an object');
  return parsed;
}

describe('event-schema package contract', () => {
  it('is private, zero-runtime-dependency, and protocol layered', async () => {
    const manifest = await readManifest();
    expect(manifest.name).toBe('@aurora/event-schema');
    expect(manifest.version).toBe('0.0.0');
    expect(manifest.private).toBe(false);
    expect(manifest.publishConfig).toEqual({ access: 'public' });
    expect(manifest.type).toBe('module');
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.devDependencies).toEqual({
      '@types/node': '24.13.3',
      '@vitest/coverage-v8': '4.1.10',
      typescript: '6.0.3',
      vitest: '4.1.10',
    });
    expect(manifest.aurora).toEqual({ layer: 'protocol' });
  });

  it('declares only the runtime root and contract testkit exports', async () => {
    const manifest = await readManifest();
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './contract-testkit': {
        types: './dist/contract-testkit/index.d.ts',
        import: './dist/contract-testkit/index.js',
      },
    });
  });

  it('declares every package verification command', async () => {
    const manifest = await readManifest();
    expect(manifest.scripts).toEqual({
      build: 'tsc -p tsconfig.build.json',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      test: 'vitest run --exclude test/package-entry.test.ts',
      'test:coverage': 'vitest run --coverage --exclude test/package-entry.test.ts',
      'test:package': 'pnpm build && vitest run test/package-entry.test.ts',
    });
  });
});
