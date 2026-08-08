import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';

/** Stable diagnostic facts emitted by the router; never carries the event body. */
export interface EventProcessorRouterDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

/** Optional bounded diagnostics port. */
export interface EventProcessorRouterDiagnostics {
  record(diagnostic: EventProcessorRouterDiagnostic): void;
}

export interface CreateEventProcessorRouterInput {
  readonly errorProcessor?: IngestionEventProcessor;
  readonly requestProcessor?: IngestionEventProcessor;
  readonly performanceProcessor?: IngestionEventProcessor;
  readonly diagnostics?: EventProcessorRouterDiagnostics;
}

const NOOP_DIAGNOSTICS: EventProcessorRouterDiagnostics = {
  record: () => undefined,
};

const REJECTED: ProcessIngestionEventResult = Object.freeze({
  outcome: 'dead-letter',
  errorCode: 'invalid_event_type',
});

/**
 * Create the final event-type routing policy for the worker. It implements the
 * IngestionEventProcessor port, dispatches one claimed event to the matching
 * injected processor by its eventType (the single source is @aurora/event-schema),
 * and propagates the processor result verbatim. resource is product-deferred and
 * unknown/missing-processor events are permanently rejected. The router never
 * parses the envelope (processors do), never touches the database / Pool / Inbox,
 * never implements retry budget / backoff / lease, never swallows a processor
 * exception, and never writes logs.
 */
export function createEventProcessorRouter(
  input: CreateEventProcessorRouterInput,
): IngestionEventProcessor {
  const diagnostics = input.diagnostics ?? NOOP_DIAGNOSTICS;

  const process = async (
    processorInput: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult> => {
    const eventType = processorInput.event.eventType;
    if (typeof eventType !== 'string') {
      diagnostics.record({
        code: 'routed_invalid_envelope',
        inboxId: processorInput.inboxId,
        attemptCount: processorInput.attemptCount,
      });
      return REJECTED;
    }
    const processor: IngestionEventProcessor | undefined =
      eventType === 'error'
        ? input.errorProcessor
        : eventType === 'request'
          ? input.requestProcessor
          : eventType === 'performance'
            ? input.performanceProcessor
            : undefined;
    if (processor === undefined) {
      diagnostics.record({
        code: eventType === 'resource' ? 'routed_resource_deferred' : 'routed_unknown_type',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return REJECTED;
    }
    diagnostics.record({
      code:
        eventType === 'error'
          ? 'routed_error'
          : eventType === 'request'
            ? 'routed_request'
            : 'routed_performance',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });
    return processor.process(processorInput, signal);
  };

  return { process };
}
