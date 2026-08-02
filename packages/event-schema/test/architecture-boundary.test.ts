import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: URL): Promise<readonly URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) return sourceFiles(url);
      return entry.isFile() && entry.name.endsWith('.ts') ? [url] : [];
    }),
  );
  return nested.flat();
}

describe('event-schema architecture boundary', () => {
  it('keeps zero runtime dependency and exactly two public entries', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).not.toHaveProperty('dependencies');
    expect(manifest).toMatchObject({
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
        './contract-testkit': {
          types: './dist/contract-testkit/index.d.ts',
          import: './dist/contract-testkit/index.js',
        },
      },
      aurora: { layer: 'protocol' },
    });
  });

  it('uses an ES-only, runtime-types-free build', async () => {
    const config: unknown = JSON.parse(
      await readFile(new URL('../tsconfig.build.json', import.meta.url), 'utf8'),
    );
    expect(config).toMatchObject({
      compilerOptions: { types: [] },
      include: ['src/**/*.ts'],
    });
  });

  it('contains no consumer, DOM, Node runtime, console, or private cross-package source', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    for (const forbidden of [
      '@aurora/core',
      '@aurora/browser',
      '@aurora/plugin-',
      "from 'node:",
      'window.',
      'document.',
      'navigator.',
      'process.',
      'Buffer.',
      'console.',
      'PerformanceObserver',
      'performance.',
      '/src/',
      '/internal/',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
