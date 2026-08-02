import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function repositoryFile(path: string): Promise<string> {
  return readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

describe('ingestion-inbox documentation contract', () => {
  it('keeps the module README complete and honest about its boundary', async () => {
    const readme = await repositoryFile('packages/ingestion-inbox/README.md');
    for (const heading of ['## 模块定位', '## 职责', '## 非职责', '## 对外接口', '## 命令']) {
      expect(readme).toContain(heading);
    }
    expect(readme).toContain('AURORA_TEST_DATABASE_URL');
    expect(readme).toContain('不实现 Fastify 路由');
    expect(readme).toContain('Worker 运行循环');
    expect(readme).toContain('event-schema');
    expect(readme).toContain('claimAvailable');
    expect(readme).toContain('markDeadLettered');
  });

  it('keeps the formal processing spec aligned with the implemented module', async () => {
    const spec = await repositoryFile('docs/architecture/ingestion-inbox-processing-repository.md');
    expect(spec).toContain('status: approved');
    expect(spec).toContain('FOR UPDATE SKIP LOCKED');
    expect(spec).toContain('lease_id');
    expect(spec).toContain('claimAvailable');
    expect(spec).toContain('renewLease');
    expect(spec).toContain('markProcessed');
    expect(spec).toContain('scheduleRetry');
    expect(spec).toContain('markDeadLettered');
    expect(spec).toContain('`pending`、`leased`、`retry_waiting`、`processed`、`dead_lettered`');
  });

  it('keeps the formal spec aligned with the implemented module', async () => {
    const spec = await repositoryFile('docs/architecture/ingestion-inbox-data-model.md');
    expect(spec).toContain('status: approved');
    expect(spec).toContain('persistBatch');
    expect(spec).toContain('event_inbox');
    expect(spec).toContain('(project_id, event_id)');
    expect(spec).toContain('AURORA_TEST_DATABASE_URL');
    expect(spec).toContain("'pending','leased','retry_waiting','processed','dead_lettered'");
  });
});
