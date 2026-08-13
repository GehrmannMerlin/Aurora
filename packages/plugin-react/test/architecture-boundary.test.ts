import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('react adapter architecture boundary', () => {
  it('is private, side-effect free, sdk-framework, and exposes one root', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      private?: unknown;
      sideEffects?: unknown;
      exports?: unknown;
      aurora?: unknown;
      dependencies?: unknown;
      peerDependencies?: unknown;
    };
    expect(manifest.private).toBe(false);
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
    expect(manifest.aurora).toEqual({ layer: 'sdk-framework' });
    expect(manifest.dependencies).toEqual({
      '@aurora/browser': 'workspace:*',
      '@aurora/core': 'workspace:*',
      '@aurora/event-schema': 'workspace:*',
    });
    expect(manifest.peerDependencies).toEqual({
      react: '^18.3.0',
      'react-dom': '^18.3.0',
    });
  });

  it('uses only public SDK roots and no host/Node runtime or event control', async () => {
    const sourceDirectory = new URL('../src/', import.meta.url);
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts'));
    const source = (
      await Promise.all(names.map((name) => readFile(join(packagePath, 'src', name), 'utf8')))
    ).join('\n');
    for (const forbidden of [
      '@aurora/core/',
      '@aurora/browser/',
      '@aurora/event-schema/',
      '@aurora/sdk/',
      '@aurora/plugin-vue',
      '@aurora/plugin-error',
      '@aurora/plugin-request',
      '@aurora/plugin-performance',
      '@aurora/plugin-react/',
      '/src/',
      '/internal/',
      "from 'node:",
      'window.',
      'document.',
      'navigator.',
      'localStorage.',
      'sessionStorage.',
      'preventDefault(',
      'stopPropagation(',
      'stopImmediatePropagation(',
      'console.',
      'Math.random',
      'EventEnvelope',
      'CURRENT_PROTOCOL_VERSION',
      'randomUUID',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
