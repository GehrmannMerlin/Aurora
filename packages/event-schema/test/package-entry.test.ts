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

describe('built package entries', () => {
  it('loads the declared root entry', () => {
    const result = importFromPackage('@aurora/event-schema');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('parseEventEnvelope');
    expect(result.stdout).toContain('CURRENT_PROTOCOL_VERSION');
  });

  it('loads the declared contract-testkit entry', () => {
    const result = importFromPackage('@aurora/event-schema/contract-testkit');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('validEventEnvelopeSamples');
    expect(result.stdout).toContain('invalidEventEnvelopeSamples');
    expect(result.stdout).toContain('boundaryEventEnvelopeSamples');
  });

  it('rejects private and unexported paths', () => {
    for (const specifier of [
      '@aurora/event-schema/src/index.js',
      '@aurora/event-schema/internal/parser.js',
      '@aurora/event-schema/value-boundaries',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
