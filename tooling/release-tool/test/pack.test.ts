import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertTarballContents } from '../src/pack.js';

describe('assertTarballContents', () => {
  it('accepts a tarball with dist + package.json and no forbidden entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-pack-'));
    try {
      writeFileSync(join(root, 'README.md'), '# readme\n');
      const entries = [
        'package/package.json',
        'package/dist/index.js',
        'package/dist/index.d.ts',
        'package/README.md',
      ];
      const result = assertTarballContents(entries, ['dist', 'README.md'], root);
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects src/test/coverage and a missing declared README', () => {
    const root = mkdtempSync(join(tmpdir(), 'aurora-pack-'));
    try {
      const entries = [
        'package/package.json',
        'package/dist/index.js',
        'package/src/index.ts',
        'package/test/foo.test.ts',
        'package/coverage/lcov.info',
      ];
      const result = assertTarballContents(entries, ['dist', 'README.md'], root);
      expect(result.ok).toBe(false);
      const messages = result.issues.map((issue) => issue.message).join(' | ');
      expect(messages).toContain('does not contain README.md');
      expect(messages).toContain('forbidden entry');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
