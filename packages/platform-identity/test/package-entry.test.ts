import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const module = await import(${JSON.stringify(specifier)}); console.log(Object.keys(module).sort().join(','));`,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built platform-identity package entry', () => {
  it('loads the declared root entry', () => {
    const result = importFromPackage('@aurora/platform-identity');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('PLATFORM_IDENTITY_PACKAGE');
    expect(result.stdout).toContain('PLATFORM_IDENTITY_VERSION');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/platform-identity/src/index.js',
      '@aurora/platform-identity/internal/repositories.js',
      '@aurora/platform-identity/repositories',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });

  it('declares the private data-layer package manifest', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      name: '@aurora/platform-identity',
      private: true,
      type: 'module',
      aurora: { layer: 'data' },
      engines: { node: '>=24.18.0 <25' },
    });
  });

  it('exports only the package root and ships dist', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
    const files = (manifest as { files?: unknown }).files;
    expect(files).toContain('dist');
  });
});
