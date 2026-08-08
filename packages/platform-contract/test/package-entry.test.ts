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

describe('built platform-contract package entries', () => {
  it('loads the root entry', () => {
    const result = importFromPackage('@aurora/platform-contract');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('PLATFORM_CONTRACT_VERSION');
    expect(result.stdout).toContain('ROUTE_TARGET_IDS');
    expect(result.stdout).toContain('identityGetSessionResponse');
    expect(result.stdout).toContain('navigationGetContextResponse');
    expect(result.stdout).toContain('PLATFORM_OPERATIONS');
    expect(result.stdout).toContain('OPERATION_MANIFEST');
    expect(result.stdout).toContain('auroraProblem');
  });

  it('loads /client, /server, /contract-testkit', () => {
    const client = importFromPackage('@aurora/platform-contract/client');
    expect(client.status).toBe(0);
    expect(client.stderr).toBe('');
    expect(client.stdout).toContain('ClientInputError');
    expect(client.stdout).toContain('buildRequest');
    expect(client.stdout).toContain('parseResponse');

    const server = importFromPackage('@aurora/platform-contract/server');
    expect(server.status).toBe(0);
    expect(server.stderr).toBe('');
    expect(server.stdout).toContain('parseInput');
    expect(server.stdout).toContain('serializeOutput');
    expect(server.stdout).toContain('problemSchema');
    expect(server.stdout).toContain('listServerOperations');

    const testkit = importFromPackage('@aurora/platform-contract/contract-testkit');
    expect(testkit.status).toBe(0);
    expect(testkit.stderr).toBe('');
    expect(testkit.stdout).toContain('validSessionSamples');
    expect(testkit.stdout).toContain('invalidSessionSamples');
    expect(testkit.stdout).toContain('validNavigationSamples');
    expect(testkit.stdout).toContain('validProblemSamples');
    expect(testkit.stdout).toContain('invalidProblemSamples');
  });

  it('rejects private and generator paths', () => {
    for (const specifier of [
      '@aurora/platform-contract/generator/openapi',
      '@aurora/platform-contract/src/index',
      '@aurora/platform-contract/common/schema',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
