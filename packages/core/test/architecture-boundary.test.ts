import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function readJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
  return parsed;
}

describe('Core architecture configuration', () => {
  it('declares only the protocol runtime dependency', async () => {
    await expect(readJson('../package.json')).resolves.toMatchObject({
      dependencies: { '@aurora/event-schema': 'workspace:*' },
      aurora: { layer: 'sdk-core' },
    });
  });

  it('keeps the public consumer compiler free of DOM types', async () => {
    await expect(readJson('../tsconfig.no-dom.json')).resolves.toMatchObject({
      compilerOptions: { types: [] },
      include: ['src/**/*.ts', 'test/no-dom-consumer.ts'],
    });
    const base = JSON.stringify(await readJson('../../../tsconfig.base.json'));
    expect(base).toContain('ES2024');
    expect(base).not.toContain('DOM');
  });
});
