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

describe('processing-store security negatives', () => {
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

  it('keeps source free of SQLSTATE, constraint names, and connection strings', async () => {
    const text = (
      await Promise.all(
        (await sourceFiles(new URL('../src/', import.meta.url))).map((file) =>
          readFile(file, 'utf8'),
        ),
      )
    ).join('\n');
    expect(text).not.toMatch(/SQLSTATE/);
    expect(text).not.toMatch(/constraint/i);
    expect(text).not.toMatch(/postgres:\/\/|postgresql:\/\//);
  });

  it('does not use console, process.env, or Math.random in production repository source', async () => {
    const files = (await sourceFiles(new URL('../src/', import.meta.url))).filter(
      (file) => !file.pathname.endsWith('run-migrations.ts'),
    );
    const text = (
      await Promise.all(
        files.map((file) => readFile(file, 'utf8')),
      )
    ).join('\n');
    expect(text).not.toMatch(/console\./);
    expect(text).not.toMatch(/process\.env/);
    expect(text).not.toMatch(/Math\.random/);
  });

  it('does not export private source paths from the package', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(JSON.stringify(exports)).not.toContain('src/');
    expect(JSON.stringify(exports)).not.toContain('internal');
  });

  it('request sample source never stores bodies, headers, cookies, or credentials', async () => {
    const requestSource = await readFile(
      new URL('../src/request-sample-repository.ts', import.meta.url),
      'utf8',
    );
    const inputSource = await readFile(
      new URL('../src/request-sample-input.ts', import.meta.url),
      'utf8',
    );
    const typesSource = await readFile(
      new URL('../src/request-sample-types.ts', import.meta.url),
      'utf8',
    );
    const text = `${requestSource}\n${inputSource}\n${typesSource}`;
    for (const forbidden of [
      'requestBody',
      'responseBody',
      'requestHeader',
      'responseHeader',
      'X-Aurora-Client-Key',
      'clientKey',
      'Authorization',
      'cookie',
      'password',
    ]) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
    // The sample projection must only persist the parsed request body, never
    // the full envelope or a JSON-serialized envelope.
    expect(text).not.toMatch(/sampleBody:\s*envelope(?!\.body)/);
    expect(text).not.toMatch(/JSON\.stringify\(envelope\)/);
    expect(text).not.toMatch(/JSON\.stringify\(parsed\)/);
  });

  it('request metric source stores only counts and low-cardinality dimensions', async () => {
    const metricTypes = await readFile(
      new URL('../src/request-metric-types.ts', import.meta.url),
      'utf8',
    );
    const metricContribution = await readFile(
      new URL('../src/request-metric-contribution.ts', import.meta.url),
      'utf8',
    );
    const metricRepository = await readFile(
      new URL('../src/request-metric-repository.ts', import.meta.url),
      'utf8',
    );
    const text = `${metricTypes}\n${metricContribution}\n${metricRepository}`;
    for (const forbidden of [
      'requestBody',
      'responseBody',
      'requestHeader',
      'responseHeader',
      'sampleBody',
      'X-Aurora-Client-Key',
      'clientKey',
      'Authorization',
      'cookie',
      'password',
      'fullUrl',
      'userAgent',
      'ipAddress',
    ]) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
    // The store must not classify failure/slow or hard-code thresholds.
    expect(text).not.toContain('3000');
    expect(text).not.toContain('isFailure: true');
    expect(text).not.toContain('isSlow: true');
    expect(text).not.toContain('persistRequestEventSample');
  });

  it('performance metric source stores only counts and low-cardinality dimensions', async () => {
    const metricTypes = await readFile(
      new URL('../src/performance-metric-types.ts', import.meta.url),
      'utf8',
    );
    const metricContribution = await readFile(
      new URL('../src/performance-metric-contribution.ts', import.meta.url),
      'utf8',
    );
    const metricRepository = await readFile(
      new URL('../src/performance-metric-repository.ts', import.meta.url),
      'utf8',
    );
    const text = `${metricTypes}\n${metricContribution}\n${metricRepository}`;
    for (const forbidden of [
      'requestBody',
      'responseBody',
      'requestHeader',
      'responseHeader',
      'sampleBody',
      'fullUrl',
      'pageUrl',
      'userAgent',
      'ipAddress',
    ]) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('performance sample source persists only the whitelist projection', async () => {
    const sampleInput = await readFile(
      new URL('../src/performance-sample-input.ts', import.meta.url),
      'utf8',
    );
    const sampleRepository = await readFile(
      new URL('../src/performance-sample-repository.ts', import.meta.url),
      'utf8',
    );
    const text = `${sampleInput}\n${sampleRepository}`;
    for (const forbidden of ['Authorization', 'cookie', 'password', 'X-Aurora-Client-Key', 'clientKey']) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
    // The projection must only persist the parsed body whitelist, never the
    // full envelope.
    expect(text).not.toMatch(/sampleBody:\s*envelope(?!\.body)/);
    expect(text).not.toMatch(/JSON\.stringify\(envelope\)/);
    expect(text).not.toMatch(/JSON\.stringify\(parsed\)/);
  });
});
