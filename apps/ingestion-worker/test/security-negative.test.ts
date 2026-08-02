import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

async function collectTsFiles(dir: URL): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = new URL(`${entry.name}/`, dir);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(fileURLToPath(new URL(entry.name, dir)));
    }
  }
  return files;
}

describe('ingestion-worker security negatives', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const testDir = new URL('../test/', import.meta.url);

  it('does not log event bodies, raw errors, SQL, SQLSTATE, or database URLs in source', async () => {
    const files = await collectTsFiles(srcDir);
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).not.toMatch(/console\.log/);
      expect(content).not.toMatch(/EventEnvelope\.body|event\.body/);
      expect(content).not.toMatch(/SQLSTATE|constraint.*name/);
      expect(content).not.toMatch(/databaseUrl\s*=\s*.*\?|postgres:\/\/[^"'`]*:[^"'`]*@/);
    }
  });

  it('does not print database credentials or full URLs in test helpers', async () => {
    const helpers = fileURLToPath(new URL('./integration/helpers.ts', testDir));
    const content = await readFile(helpers, 'utf8');
    expect(content).not.toMatch(/console\.log/);
  });
});
