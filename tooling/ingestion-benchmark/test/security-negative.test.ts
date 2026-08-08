import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== 'node_modules' && entry.name !== 'dist')
      .map(async (entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(path);
        return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
      }),
  );
  return nested.flat();
}

describe('security negative scan', () => {
  it('src and test never contain raw secrets, SQL dumps or event bodies in logs', async () => {
    const files = await listSourceFiles(join(ROOT, 'src'));
    const testFiles = await listSourceFiles(join(ROOT, 'test'));
    const commonForbidden = ['console.log(', 'password=', 'sqlstate'];
    for (const file of [...files, ...testFiles]) {
      if (file.endsWith('security-negative.test.ts')) continue;
      const content = await readFile(file, 'utf8');
      const lower = content.toLowerCase();
      for (const token of commonForbidden) {
        if (lower.includes(token)) {
          throw new Error(`${file} contains forbidden pattern "${token}"`);
        }
      }
    }
    // Raw credential format and connection strings never appear in src (test
    // files may legitimately use them to assert that rendered output does not
    // leak them).
    for (const file of files) {
      const content = await readFile(file, 'utf8');
      const lower = content.toLowerCase();
      if (
        lower.includes('aurora_ingest_') ||
        content.includes('postgresql://') ||
        content.includes('postgres://')
      ) {
        throw new Error(`${file} contains a credential or connection string`);
      }
    }
  });
});
