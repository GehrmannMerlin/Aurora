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

describe('built @aurora/sdk package entries', () => {
  it('loads the declared root entry with the control-plane public API', () => {
    const result = importFromPackage('@aurora/sdk');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    for (const symbol of [
      'parseSdkConfig',
      'createSdkControlPlane',
      'applySdkPrivacyFilter',
      'applySdkBeforeSend',
      'decideEventSample',
      'decideSdkSample',
      'classifyRequestEvent',
    ]) {
      expect(result.stdout).toContain(symbol);
    }
  });

  it('rejects private subpaths', () => {
    for (const specifier of ['@aurora/sdk/src', '@aurora/sdk/internal', '@aurora/sdk/configuration']) {
      const result = importFromPackage(specifier);
      expect(result.status).not.toBe(0);
    }
  });
});
