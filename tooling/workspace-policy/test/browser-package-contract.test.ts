import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('browser package contract', () => {
  it('is private, root-only, sdk-browser layered, and has no runtime dependencies', async () => {
    const text = await readFile(
      new URL('../../../packages/browser/package.json', import.meta.url),
      'utf8',
    );
    const manifest: unknown = JSON.parse(text);
    if (!isRecord(manifest)) throw new TypeError('browser package.json must be an object');
    expect(manifest).toMatchObject({
      name: '@aurora/browser',
      version: '0.0.0',
      private: true,
      type: 'module',
      sideEffects: false,
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      aurora: { layer: 'sdk-browser' },
    });
    expect(manifest.dependencies).toBeUndefined();
  });
});
