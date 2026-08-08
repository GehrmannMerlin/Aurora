import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from '@aurora/ingestion-worker';

/** Benchmark-internal synthetic processor policy. */
export interface SyntheticProcessorOptions {
  /** Artificial processing delay in ms before returning. */
  readonly delayMs?: number;
  /** If a retry result should be returned (for the retry-budget scenario). */
  readonly retry?: { readonly eventIds: ReadonlySet<string>; readonly availableAt: Date };
  /** If a dead-letter result should be returned (for the dead-letter scenario). */
  readonly deadLetter?: { readonly eventIds: ReadonlySet<string> };
}

/**
 * Synthetic processor used only by the benchmark tool. Returns `processed` for
 * every event, optionally `retry` or `dead-letter` for a specified set. It
 * never performs real business processing and is never exported from the
 * package root.
 */
export function createSyntheticProcessor(
  options: SyntheticProcessorOptions = {},
): IngestionEventProcessor {
  const delay = options.delayMs ?? 0;
  return {
    async process(input: ProcessIngestionEventInput): Promise<ProcessIngestionEventResult> {
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      if (options.retry?.eventIds.has(input.eventId) === true) {
        return {
          outcome: 'retry',
          availableAt: options.retry.availableAt,
          errorCode: 'service_temporarily_unavailable',
        };
      }
      if (options.deadLetter?.eventIds.has(input.eventId) === true) {
        return { outcome: 'dead-letter', errorCode: 'invalid_schema' };
      }
      return { outcome: 'processed' };
    },
  };
}
