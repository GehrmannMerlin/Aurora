import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('ingestion-worker documentation contract', () => {
  it('keeps the module README complete and honest about its boundary', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('@aurora/ingestion-worker');
    expect(readme).toContain('claimAvailable');
    expect(readme).toContain('renewLease');
    expect(readme).toContain('AURORA_TEST_DATABASE_URL');
    expect(readme).toContain('@aurora/ingestion-inbox');
    expect(readme).toContain('请求样本选择策略');
    expect(readme).toContain('createRequestEventProcessor');
    expect(readme).toContain('createRequestProcessingRulesAdapter');
    expect(readme).toContain('DEFAULT_REQUEST_PROCESSING_RULES');
    // The README must not claim concrete event processors or manual replay exist.
    expect(readme).not.toContain('具体错误事件处理器已实现');
    expect(readme).not.toContain('人工重放已实现');
  });
});
