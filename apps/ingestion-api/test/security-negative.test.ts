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

describe('ingestion-api security negatives', () => {
  it('never logs request bodies or parsed body values', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    expect(text).not.toMatch(/logger\.[a-z]+\([^)]*body/);
    expect(text).not.toMatch(/console\.log\([^)]*body/);
    expect(text).not.toMatch(/logger\.[a-z]+\([^)]*request/);
  });

  it('never writes client key values into a log call', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    expect(text).not.toMatch(/console\.log\([^)]*clientKey/);
    expect(text).not.toMatch(/logger\.[a-z]+\([^)]*clientKey/);
  });

  it('never leaks SQLSTATE or constraint names in error bodies', async () => {
    const errors = await readFile(new URL('../src/error-mapper.ts', import.meta.url), 'utf8');
    // The JSDoc may mention these words as what NOT to expose; the actual error
    // bodies must not carry SQLSTATE or constraint-name text.
    expect(errors).not.toMatch(/SQLSTATE/);
    expect(errors).not.toMatch(/\.sql\b/);
  });

  it('never returns a wildcard or cookie credentials in CORS headers', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    expect(text).not.toContain("Access-Control-Allow-Origin', '*'");
    expect(text).not.toContain('Access-Control-Allow-Origin\', "*"');
    expect(text).not.toContain('Access-Control-Allow-Credentials: true');
    expect(text).not.toContain("Access-Control-Allow-Credentials', 'true");
  });

  it('keeps route modules free of process.env access', async () => {
    const routes = await readFile(
      new URL('../src/routes/ingestion-batches.ts', import.meta.url),
      'utf8',
    );
    expect(routes).not.toContain('process.env');
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
