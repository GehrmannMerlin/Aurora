import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: URL): Promise<readonly URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) return sourceFiles(url);
      return entry.isFile() && entry.name.endsWith('.ts') ? [url] : [];
    }),
  );
  return nested.flat();
}

describe('ingestion-inbox security negatives', () => {
  it('never stores client key, secret, or sensitive header column names', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    for (const forbidden of [
      'X-Aurora-Client-Key',
      'clientKey',
      'Authorization',
      'cookie',
      'requestHeader',
      'secret',
    ]) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('never interpolates untrusted values into SQL strings', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    expect(text).not.toMatch(/\+ \$\{/);
    expect(text).not.toMatch(/`[^`]*\$\{[^`]*`[^`]*INSERT/);
  });

  it('keeps error types free of SQLSTATE, constraint, and SQL text', async () => {
    const errors = await readFile(new URL('../src/errors.ts', import.meta.url), 'utf8');
    expect(errors).not.toMatch(/SQLSTATE/);
    expect(errors).not.toMatch(/constraint/i);
    expect(errors).not.toMatch(/\.sql\b/);
  });

  it('does not export private source paths from the package', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(JSON.stringify(exports)).not.toContain('src/');
    expect(JSON.stringify(exports)).not.toContain('internal');
  });
});
