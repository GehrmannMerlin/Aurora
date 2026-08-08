import {
  parsePerformanceEventEnvelope,
  type IngestionErrorCode,
} from '@aurora/event-schema';
import type {
  PersistPerformanceMetricContributionResult,
  PerformanceMetricContributionInput,
} from '@aurora/processing-store';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';
import { calculateRetryBackoffSchedule } from './retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider } from './retry-backoff-entropy.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';

/** Stable diagnostic facts emitted by the performance processor; never carries the event body. */
export interface PerformanceEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

/** Optional bounded diagnostics port. */
export interface PerformanceEventProcessorDiagnostics {
  record(diagnostic: PerformanceEventProcessorDiagnostic): void;
}

/** Inject the processing-store root performance metric persistence function or a compatible fake. */
export type PersistPerformanceMetricFn = (
  input: PerformanceMetricContributionInput,
) => Promise<PersistPerformanceMetricContributionResult>;

export interface CreatePerformanceEventProcessorInput {
  readonly persistMetric: PersistPerformanceMetricFn;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: PerformanceEventProcessorDiagnostics;
}

const NOOP_DIAGNOSTICS: PerformanceEventProcessorDiagnostics = {
  record: () => undefined,
};

/**
 * Map a processing-store performance metric persistence result to the worker
 * processed / dead-letter outcome. applied and duplicate are idempotent success;
 * invalid_input is a permanent rejection (SDK must not retry).
 * temporarily_unavailable is handled by the factory (it needs backoff) and
 * throws as a program-defect branch here.
 */
export function mapPerformanceMetricResultToWorkerResult(
  result: PersistPerformanceMetricContributionResult,
):
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode } {
  if (result.status === 'applied' || result.status === 'duplicate') {
    return { outcome: 'processed' };
  }
  if (result.status === 'invalid_input') {
    return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
  }
  // temporarily_unavailable is a temporary outcome, not a terminal mapping.
  throw new Error('temporarily_unavailable is not a terminal worker outcome');
}

/**
 * Create a concrete performance event processor. It accepts the worker
 * processing input, validates that the envelope is a performance event, parses
 * it through the @aurora/event-schema root, constructs the DAT-08 approved
 * aggregate contribution, persists it through the injected processing-store
 * root function, and maps the stable result to the worker outcome (processed /
 * retry / dead-letter). This increment aggregates every valid performance event
 * delivered to its boundary and does NOT persist bounded performance diagnostic
 * samples (persistPerformanceEventSample is not called); upstream SDK sampling
 * and downstream diagnostic-sample selection are separate concerns. Never
 * touches the database directly, never creates or closes a Pool, never copies
 * retry budget / backoff / lease / store logic, and never writes logs.
 */
export function createPerformanceEventProcessor(
  input: CreatePerformanceEventProcessorInput,
): IngestionEventProcessor {
  const calculateBackoff = input.calculateBackoff ?? calculateRetryBackoffSchedule;
  const entropyProvider = input.entropyProvider ?? createNodeCryptoEntropyProvider();
  const now = input.now ?? (() => new Date());
  const diagnostics = input.diagnostics ?? NOOP_DIAGNOSTICS;

  const computeRetry = (
    inboxId: number,
    eventType: string,
    attemptCount: number,
  ): ProcessIngestionEventResult => {
    const backoffResult = calculateBackoff({
      config: input.backoff,
      attemptCount,
      now: now(),
      entropy: entropyProvider.next(),
    });
    if (backoffResult.status !== 'success') {
      // Program defect: the caller supplied an invalid backoff configuration.
      // Do not silently downgrade to a business retry; let the worker runtime
      // treat this as an unclassified processor failure (ADR-015).
      throw new Error('invalid retry backoff configuration');
    }
    diagnostics.record({ code: 'temporarily_unavailable', inboxId, eventType, attemptCount });
    return {
      outcome: 'retry',
      availableAt: backoffResult.availableAt,
      errorCode: 'service_temporarily_unavailable',
    };
  };

  const process = async (
    processorInput: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult> => {
    // The performance processor is synchronous with the store call and does not
    // need the abort signal for cooperative cancellation; the runtime owns
    // shutdown. The eventType guard below is a local precondition, NOT the
    // final routing policy for non-performance events (that remains blocked).
    void signal;
    const eventType = processorInput.event.eventType;
    if (eventType !== 'performance') {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }

    const parseResult = parsePerformanceEventEnvelope(processorInput.event);
    if (!parseResult.success) {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }
    const envelope = parseResult.data;

    const contribution: PerformanceMetricContributionInput = {
      projectId: processorInput.projectId,
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
      metricName: envelope.body.metricName,
      unit: envelope.body.unit,
      value: envelope.body.value,
      startedAt: envelope.body.startedAt,
      ...(envelope.body.durationMs !== undefined ? { durationMs: envelope.body.durationMs } : {}),
    };

    const metricResult = await input.persistMetric(contribution);

    if (metricResult.status === 'temporarily_unavailable') {
      return computeRetry(processorInput.inboxId, eventType, processorInput.attemptCount);
    }
    const mapping = mapPerformanceMetricResultToWorkerResult(metricResult);
    diagnostics.record({
      code: metricResult.status === 'applied' ? 'performance_applied' : 'performance_duplicate',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });
    return mapping;
  };

  return { process };
}
