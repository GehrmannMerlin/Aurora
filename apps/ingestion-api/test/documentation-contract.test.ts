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

  it('keeps the formal spec aligned with the implemented module', async () => {
    const spec = await repositoryFile('docs/architecture/ingestion-http-service.md');
    expect(spec).toContain('status: approved');
    expect(spec).toContain('POST /v1/batches');
    expect(spec).toContain('buildIngestionApi');
    expect(spec).toContain('startIngestionApi');
    expect(spec).toContain('IngestionRequestAuthorizer');
    expect(spec).toContain('Fastify 5.10.0');
  });
});
