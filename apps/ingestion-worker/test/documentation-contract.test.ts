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

  it('keeps the formal retry budget spec aligned with the implemented module', async () => {
    const spec = await readFile(
      new URL(
        '../../../docs/architecture/ingestion-worker-retry-budget-policy.md',
        import.meta.url,
      ),
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

  it('keeps the request sample selection policy spec honest and aligned', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/request-sample-selection-policy.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('decideRequestSampleSelection');
    expect(spec).toContain('http_429');
    expect(spec).toContain('configured_status');
    expect(spec).toContain('ADR-019');
    expect(spec).toContain('not-started');
  });

  it('keeps the request event processor spec honest about the production-wiring boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/request-event-processor.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createRequestEventProcessor');
    expect(spec).toContain('persistRequestMetricContribution');
    expect(spec).toContain('persistRequestEventSample');
    expect(spec).toContain('decideRequestSampleSelection');
    expect(spec).toContain('不等于 production Worker 已能处理 Request 事件');
    expect(spec).toContain('blocked');
  });

  it('keeps the request processing rules adapter spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL(
        '../../../docs/architecture/request-processing-rules-configuration-adapter.md',
        import.meta.url,
      ),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createRequestProcessingRulesAdapter');
    expect(spec).toContain('DEFAULT_REQUEST_PROCESSING_RULES');
    expect(spec).toContain('slowRequestThresholdMs');
    expect(spec).toContain('无需新 ADR');
  });

  it('keeps the performance event processor spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/performance-event-processor.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createPerformanceEventProcessor');
    expect(spec).toContain('persistPerformanceMetricContribution');
    expect(spec).toContain('不调用');
    expect(spec).toContain('persistPerformanceEventSample');
  });

  it('keeps the event processor router spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/event-processor-router.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createEventProcessorRouter');
    expect(spec).toContain('纯分发器');
    expect(spec).toContain('resource');
  });

  it('keeps the production worker composition spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/production-worker-composition-root.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createProductionIngestionWorker');
    expect(spec).toContain('Router');
    expect(spec).toContain('fake/noop');
  });
});
