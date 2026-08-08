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

describe('built platform-session package entry', () => {
  it('loads the declared root entry', () => {
    const result = importFromPackage('@aurora/platform-session');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('PLATFORM_SESSION_PACKAGE');
    expect(result.stdout).toContain('PLATFORM_SESSION_VERSION');
    expect(result.stdout).toContain('createSession');
    expect(result.stdout).toContain('createSessionStore');
    expect(result.stdout).toContain('getSession');
    expect(result.stdout).toContain('rotateSession');
    expect(result.stdout).toContain('revokeSession');
    expect(result.stdout).toContain('revokeAllAccountSessions');
    expect(result.stdout).toContain('createCsrfSecret');
    expect(result.stdout).toContain('verifyCsrf');
    expect(result.stdout).toContain('sessionCookieOptions');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/platform-session/src/index.js',
      '@aurora/platform-session/internal/session-store.js',
      '@aurora/platform-session/session-store',
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
      name: '@aurora/platform-session',
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
