import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('Browser architecture boundary', () => {
  it('declares only sdk-core runtime dependencies and has one root export', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      aurora: { layer: 'sdk-browser' },
      dependencies: { '@aurora/core': 'workspace:*', '@aurora/sdk': 'workspace:*' },
    });
    expect(Object.keys((manifest as { dependencies: Record<string, unknown> }).dependencies)).toEqual([
      '@aurora/core',
      '@aurora/sdk',
    ]);
  });

  it('keeps the browser environment foundation free of cross-package, protocol, private, body, or console source', async () => {
    // sdk-composition.ts is the browser SDK composition entry (SDK-10) and is the
    // single intentional module that consumes @aurora/core + @aurora/sdk.
    const names = (await readdir(new URL('../src/', import.meta.url))).filter(
      (name) => name.endsWith('.ts') && name !== 'sdk-composition.ts',
    );
    const source = (
      await Promise.all(names.map((name) => readFile(join(packagePath, 'src', name), 'utf8')))
    ).join('\n');
    for (const forbidden of [
      '@aurora/event-schema',
      '@aurora/core',
      'parseRequestEventBody',
      'RequestEventEnvelope',
      'responseText',
      'getAllResponseHeaders',
      'document.cookie',
      'localStorage',
      'sessionStorage',
      'console.',
      '/src/',
      '/internal/',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
