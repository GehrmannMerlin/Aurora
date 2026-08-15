import type { Pool } from 'pg';
import {
  persistErrorEventOccurrence,
  persistPerformanceMetricContribution,
  persistRequestEventSample,
  persistRequestMetricContribution,
} from '@aurora/processing-store';
import type { IngestionWorkerConfig } from './configuration.js';
import type { IngestionEventProcessor } from './processor.js';
import { createErrorEventProcessor } from './error-event-processor.js';
import { createRequestEventProcessor } from './request-event-processor.js';
import { createPerformanceEventProcessor } from './performance-event-processor.js';
import {
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
} from './request-processing-rules-adapter.js';
import { createEventProcessorRouter } from './event-processor-router.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';

export interface ProductionCompositionOptions {
  readonly config: IngestionWorkerConfig;
  readonly pool: Pool;
  readonly backoff?: RetryBackoffConfig;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
}

export interface ProductionIngestionWorker {
  readonly processor: IngestionEventProcessor;
  readonly close: () => Promise<void>;
}

/**
 * Production composition root: wires the three real processors, the DAT-07
 * request-processing rules adapter, and the DAT-10 router over the caller-owned
 * PostgreSQL Pool. The caller (startIngestionWorker) owns the Pool lifecycle;
 * this composition never opens or closes a Pool. Returns the router as the
 * worker's processor plus an idempotent close. No fake/noop processors are used;
 * the performance processor aggregates every valid performance event and does
 * not persist diagnostic samples (V1).
 */
export function createProductionIngestionWorker(
  options: ProductionCompositionOptions,
): ProductionIngestionWorker {
  const backoff = options.backoff ?? { initialDelayMs: 100, maxDelayMs: 60_000 };
  const entropyProvider = options.entropyProvider ?? { next: () => 0 };
  const now = options.now ?? (() => new Date());

  const rulesAdapter = createRequestProcessingRulesAdapter({
    rules: DEFAULT_REQUEST_PROCESSING_RULES,
  });

  const errorProcessor = createErrorEventProcessor({
    persist: (input) => persistErrorEventOccurrence(options.pool, input),
    backoff,
    entropyProvider,
    now,
  });

  const requestProcessor = createRequestEventProcessor({
    persistMetric: (input) => persistRequestMetricContribution(options.pool, input),
    persistSample: (input) => persistRequestEventSample(options.pool, input),
    classify: (input) => rulesAdapter.classify(input),
    backoff,
    entropyProvider,
    now,
  });

  const performanceProcessor = createPerformanceEventProcessor({
    persistMetric: (input) => persistPerformanceMetricContribution(options.pool, input),
    backoff,
    entropyProvider,
    now,
  });

  const router = createEventProcessorRouter({
    errorProcessor,
    requestProcessor,
    performanceProcessor,
  });

  let closed = false;
  const close = (): Promise<void> => {
    // Idempotent; the caller owns Pool lifecycle, so nothing is closed here.
    closed = true;
    void closed;
    return Promise.resolve();
  };

  return { processor: router, close };
}
