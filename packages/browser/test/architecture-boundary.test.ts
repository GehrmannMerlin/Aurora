import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

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
});
