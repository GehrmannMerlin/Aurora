import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const module = await import(${JSON.stringify(specifier)}); console.log(Object.keys(module).sort().join(','));`,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built processing-store package entry', () => {
  it('loads the declared root entry', () => {
    const result = importFromPackage('@aurora/processing-store');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('persistErrorEventOccurrence');
    expect(result.stdout).toContain('persistRequestEventSample');
    expect(result.stdout).toContain('persistRequestMetricContribution');
    expect(result.stdout).toContain('ProcessingStoreError');
    expect(result.stdout).toContain('persistPerformanceMetricContribution');
    expect(result.stdout).toContain('persistPerformanceEventSample');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/processing-store/src/index.js',
      '@aurora/processing-store/internal/parser.js',
      '@aurora/processing-store/error-occurrence-repository',
      '@aurora/processing-store/error-occurrence-input',
      '@aurora/processing-store/error-occurrence-types',
      '@aurora/processing-store/request-sample-repository',
      '@aurora/processing-store/request-sample-input',
      '@aurora/processing-store/request-sample-types',
      '@aurora/processing-store/request-metric-repository',
      '@aurora/processing-store/request-metric-contribution',
      '@aurora/processing-store/request-metric-types',
      '@aurora/processing-store/errors',
      '@aurora/processing-store/performance-metric-repository',
      '@aurora/processing-store/performance-metric-contribution',
      '@aurora/processing-store/performance-metric-types',
      '@aurora/processing-store/performance-sample-repository',
      '@aurora/processing-store/performance-sample-input',
      '@aurora/processing-store/performance-sample-types',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });

  it('declares every runtime import as a production dependency', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(manifest).toMatchObject({
      dependencies: { '@aurora/event-schema': 'workspace:*', pg: '8.22.0' },
      aurora: { layer: 'data' },
    });
    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
      throw new TypeError('manifest must be an object');
    }
    const devDependencies = (manifest as { devDependencies?: unknown }).devDependencies;
    expect(devDependencies).not.toMatchObject({ '@aurora/event-schema': 'workspace:*' });
  });

  it('never exposes private paths through the package exports map', async () => {
    const manifest: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const exports = (manifest as { exports?: unknown }).exports;
    expect(exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
  });
});
