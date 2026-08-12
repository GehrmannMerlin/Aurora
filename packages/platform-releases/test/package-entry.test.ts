import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('@aurora/platform-releases package entry', () => {
  it('exports only from the package root (no private src paths)', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exportsField = (manifest as { exports?: unknown }).exports;
    expect(JSON.stringify(exportsField)).not.toContain('src/');
  });
});
