import { describe, expect, it } from 'vitest';
import { buildDeprecateArgs, buildDistTagArgs, describeRollback } from '../src/deprecate.js';

describe('buildDeprecateArgs', () => {
  it('builds an npm deprecate command for a bad version', () => {
    expect(buildDeprecateArgs('@aurora/core', '0.1.0', 'replaced by 0.1.1')).toEqual([
      'deprecate',
      '@aurora/core@0.1.0',
      'replaced by 0.1.1',
    ]);
  });
});

describe('buildDistTagArgs', () => {
  it('builds an npm dist-tag add for restoring latest', () => {
    expect(buildDistTagArgs('@aurora/core', '0.0.9', 'latest')).toEqual([
      'dist-tag',
      'add',
      '@aurora/core@0.0.9',
      'latest',
    ]);
  });
});

describe('describeRollback', () => {
  it('describes the deprecate -> restore latest -> corrected patch path', () => {
    const steps = describeRollback('@aurora/core', '0.1.0', '0.0.9');
    expect(steps.join('\n')).toContain('npm deprecate @aurora/core@0.1.0');
    expect(steps.join('\n')).toContain('npm dist-tag add @aurora/core@0.0.9 latest');
    expect(steps.join('\n')).toContain('corrected patch');
  });
});
