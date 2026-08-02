import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '../src/index.js';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('ingestion OpenAPI documentation contract', () => {
  it('keeps the tooling README complete and honest about its boundary', async () => {
    const readme = await repositoryFile('tooling/ingestion-openapi-contract/README.md');
    for (const heading of ['## 模块定位', '## 职责', '## 非职责', '## 命令']) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('event-schema');
    expect(readme).not.toContain('实现接入服务');
  });

  it('keeps the formal spec aligned with the machine file', async () => {
    const spec = await repositoryFile('docs/api/ingestion-openapi.md');
    const document = await loadOpenApiDocument();
    expect(spec).toContain('status: approved');
    expect(spec).toContain('/v1/batches');
    expect(spec).toContain('ClientIngestionKey');
    expect(spec).toContain('X-Aurora-Client-Key');
    expect(spec).toContain('X-Aurora-Environment');
    expect(spec).toContain('X-Aurora-Request-Id');
    expect(spec).toContain('3.1.0');
    expect(spec).toContain('IngestionRequestReceipt');
    expect(spec).toContain('IngestionEventReceipt');
    expect(spec).toContain('ErrorResponse');
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.title).toBe('Aurora Data Ingestion API');
  });

  it('keeps the machine file free of a second batch schema authority', async () => {
    const spec = await repositoryFile('docs/api/ingestion-openapi.md');
    expect(spec).toContain('不是第二套协议来源');
    expect(spec).toContain('唯一机器来源');
  });
});
