import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function readManifest(): Promise<Record<string, unknown>> {
  const text = await readFile(
    new URL('../../../packages/core/package.json', import.meta.url),
    'utf8',
  );
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new TypeError('core package.json must be an object');
  return parsed;
}

describe('core package contract', () => {
  it('is private, sdk-core layered, and depends only on event-schema', async () => {
    const manifest = await readManifest();
    expect(manifest).toMatchObject({
      name: '@aurora/core',
      version: '0.0.0',
      publishConfig: { access: 'public' },
      type: 'module',
      sideEffects: false,
      engines: { node: '>=24.18.0 <25' },
      aurora: { layer: 'sdk-core' },
      dependencies: { '@aurora/event-schema': 'workspace:*' },
    });
    expect(Object.keys(isRecord(manifest.dependencies) ? manifest.dependencies : {})).toEqual([
      '@aurora/event-schema',
    ]);
  });

  it('exposes only the package root', async () => {
    const manifest = await readManifest();
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
  });
});
