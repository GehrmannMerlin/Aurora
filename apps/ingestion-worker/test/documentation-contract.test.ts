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
    // The README must not claim concrete event processors or manual replay exist.
    expect(readme).not.toContain('具体错误事件处理器已实现');
    expect(readme).not.toContain('人工重放已实现');
  });

  it('keeps the formal retry budget spec aligned with the implemented module', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/ingestion-worker-retry-budget-policy.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('maxProcessingAttempts');
    expect(spec).toContain('retry_budget_exhausted');
    expect(spec).toContain('decideRetryDisposition');
    expect(spec).toContain('人工重放');
  });

  it('keeps the formal spec aligned with the implemented module', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/ingestion-worker-runtime.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('apps/ingestion-worker');
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('buildIngestionWorker');
    expect(spec).toContain('startIngestionWorker');
    expect(spec).toContain('lease_lost');
    expect(spec).toContain('shutdownGracePeriodMs');
    expect(spec).toContain('具体错误、请求、性能事件处理器');
  });
});
