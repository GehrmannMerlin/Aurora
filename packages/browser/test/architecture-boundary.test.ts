import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('Browser architecture boundary', () => {
  it('declares no Aurora runtime dependency and has one root export', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      aurora: { layer: 'sdk-browser' },
    });
    expect((manifest as { dependencies?: unknown }).dependencies).toBeUndefined();
  });

  it('contains no cross-package, protocol, private, body, or console source', async () => {
    const names = (await readdir(new URL('../src/', import.meta.url))).filter((name) =>
      name.endsWith('.ts'),
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
