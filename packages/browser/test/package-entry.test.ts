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

describe('built Browser package entry', () => {
  it('loads the one declared runtime root', () => {
    const result = importFromPackage('@aurora/browser');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(
      'BrowserCapabilityName,BrowserDestroyCode,BrowserDiagnosticCode,BrowserDiagnosticOperation,' +
        'BrowserSubscribeCode,BrowserUnsubscribeCode,PageLifecycleEventType,PageVisibilityState,' +
        'createBrowserEnvironment',
    );
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/browser/src/index.js',
      '@aurora/browser/internal/safe-access.js',
      '@aurora/browser/page-lifecycle',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
