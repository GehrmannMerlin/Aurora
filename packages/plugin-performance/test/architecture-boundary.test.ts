import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('performance plugin architecture boundary', () => {
  it('is private, side-effect free, sdk-plugin, and exposes one root', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      private?: unknown;
      sideEffects?: unknown;
      exports?: unknown;
      aurora?: unknown;
      dependencies?: unknown;
    };
    expect(manifest.private).toBe(false);
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
    expect(manifest.aurora).toEqual({ layer: 'sdk-plugin' });
    expect(manifest.dependencies).toEqual({
      '@aurora/browser': 'workspace:*',
      '@aurora/core': 'workspace:*',
      '@aurora/event-schema': 'workspace:*',
    });
  });

  it('uses only the three package roots and no host or Node runtime', async () => {
    const sourceDirectory = new URL('../src/', import.meta.url);
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts'));
    const source = (
      await Promise.all(names.map((name) => readFile(join(packagePath, 'src', name), 'utf8')))
    ).join('\n');
    for (const forbidden of [
      '@aurora/core/',
      '@aurora/browser/',
      '@aurora/event-schema/',
      '@aurora/plugin-error',
      '@aurora/plugin-request',
      '/src/',
      '/internal/',
      "from 'node:",
      'window.',
      'document.',
      'preventDefault(',
      'stopPropagation(',
      'stopImmediatePropagation(',
      'console.',
      'Math.random',
      'EventEnvelope',
      'CURRENT_PROTOCOL_VERSION',
      'randomUUID',
      'Date.now',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
