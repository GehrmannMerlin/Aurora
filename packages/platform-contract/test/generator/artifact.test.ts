import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '../../src/generator/openapi.js';
import { OPERATION_MANIFEST } from '../../src/registry/manifest.js';

describe('generated artifact', () => {
  it('committed YAML matches a fresh generation', async () => {
    const { stringify } = await import('yaml');
    const fresh = stringify(generateOpenApiDocument());
    const committed = await readFile(
      new URL('../../../../docs/api/platform-openapi-v1.yaml', import.meta.url),
      'utf8',
    );
    expect(committed.replace(/^# 由契约源码生成、禁止手工修改\n/, '')).toBe(fresh);
  });

  it('manifest marks platform.resource-policies stable', () => {
    expect(OPERATION_MANIFEST.routeTargetCoverage['platform.resource-policies']).toBe('stable');
  });
});
