import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('ingestion-api documentation contract', () => {
  it('keeps the module README complete and honest about its boundary', async () => {
    const readme = await repositoryFile('apps/ingestion-api/README.md');
    for (const heading of ['## 模块定位', '## 职责', '## 非职责', '## 命令']) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('AURORA_TEST_DATABASE_URL');
    expect(readme).toContain('不实现真实凭证数据库');
    expect(readme).toContain('不实现 Worker');
  });
});
