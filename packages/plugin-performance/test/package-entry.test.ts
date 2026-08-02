import { spawnSync } from 'node:child_process';
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

describe('built performance plugin entry', () => {
  it('loads only the declared public runtime values', () => {
    const result = importFromPackage('@aurora/plugin-performance');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(
      'PERFORMANCE_CAPTURE_PLUGIN_NAME,PerformanceCaptureDiagnosticCode,' +
        'PerformanceCaptureDiagnosticOperation,createPerformanceCapturePlugin',
    );
  });

  it('rejects every private or undeclared path', () => {
    for (const specifier of [
      '@aurora/plugin-performance/src/index.js',
      '@aurora/plugin-performance/internal/diagnostics.js',
      '@aurora/plugin-performance/performance-capture-plugin',
      '@aurora/plugin-performance/performance-event-converter',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
