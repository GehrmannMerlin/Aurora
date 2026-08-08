import {
  parseRequestEventEnvelope,
  type IngestionErrorCode,
  type RequestMethod,
  type RequestOutcome,
} from '@aurora/event-schema';
import type {
  PersistRequestEventSampleResult,
  PersistRequestMetricContributionResult,
  RequestMetricContributionInput,
} from '@aurora/processing-store';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';
import { calculateRetryBackoffSchedule } from './retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider } from './retry-backoff-entropy.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';
import { decideRequestSampleSelection } from './request-sample-selection-policy.js';

/**
 * Safe minimal facts a classifier needs to decide failure/slow/additional-status
 * for one already-parsed request event. Never carries request bodies, response
 * bodies, headers, cookies, credentials, full URLs, query parameters, page
 * text, user information, the full event JSON, or any database row / 0-sentinel.
 */
export interface RequestEventClassificationInput {
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly method: RequestMethod;
}

/** Classification produced by an injected port; the processor never derives it. */
export interface RequestEventClassification {
  readonly isFailure: boolean;
  readonly isSlow: boolean;
  readonly isAdditionalMonitoredStatus: boolean;
}

/**
 * Injectable classification port. May be asynchronous to support a future
 * configuration adapter; this increment only consumes a deterministic fake.
 * Must not mutate input, write to the database, or log raw events.
 */
export type ClassifyRequestEvent = (
  input: RequestEventClassificationInput,
) => Promise<RequestEventClassification>;

/** Stable diagnostic facts emitted by the request processor; never carries the event body. */
export interface RequestEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

/** Optional bounded diagnostics port. */
export interface RequestEventProcessorDiagnostics {
  record(diagnostic: RequestEventProcessorDiagnostic): void;
}

/** Inject the processing-store root metric persistence function or a compatible fake. */
export type PersistRequestMetricFn = (
  input: RequestMetricContributionInput,
) => Promise<PersistRequestMetricContributionResult>;

/** Inject the processing-store root sample persistence function or a compatible fake. */
export type PersistRequestSampleFn = (input: {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}) => Promise<PersistRequestEventSampleResult>;

export interface CreateRequestEventProcessorInput {
  readonly persistMetric: PersistRequestMetricFn;
  readonly persistSample: PersistRequestSampleFn;
  readonly classify: ClassifyRequestEvent;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: RequestEventProcessorDiagnostics;
}

const NOOP_DIAGNOSTICS: RequestEventProcessorDiagnostics = {
  record: () => undefined,
};

/**
 * Map a processing-store metric persistence result to a worker continuation or
 * terminal outcome. applied and duplicate are idempotent success (continue to
 * sample selection); invalid_input is a permanent rejection; temporarily
 * unavailable is handled by the factory (it needs backoff) and throws as a
 * program-defect branch here.
 */
export function mapMetricResultToContinuation(
  result: PersistRequestMetricContributionResult,
):
  | { readonly status: 'continue' }
  | { readonly status: 'dead-letter'; readonly errorCode: IngestionErrorCode } {
  if (result.status === 'applied' || result.status === 'duplicate') {
    return { status: 'continue' };
  }
  if (result.status === 'invalid_input') {
    return { status: 'dead-letter', errorCode: 'invalid_event_type' };
  }
  throw new Error('temporarily_unavailable is not a terminal metric outcome');
}

/**
 * Map a processing-store sample persistence result to a worker processed /
 * dead-letter outcome. inserted and duplicate are idempotent success;
 * invalid_input is a permanent rejection (SDK must not retry).
 * temporarily_unavailable is handled by the factory (it needs backoff) and
 * throws as a program-defect branch here.
 */
export function mapSampleResultToWorkerResult(
  result: PersistRequestEventSampleResult,
):
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode } {
  if (result.status === 'inserted' || result.status === 'duplicate') {
    return { outcome: 'processed' };
  }
  if (result.status === 'invalid_input') {
    return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
  }
  throw new Error('temporarily_unavailable is not a terminal sample outcome');
}

/**
 * Create a concrete request event processor. It accepts the worker processing
 * input, validates that the envelope is a request event, parses it through the
 * @aurora/event-schema root, classifies it through the injected port, applies
 * the request metric contribution, decides sample eligibility through the
 * existing selection policy, persists a bounded safe sample only when selected,
 * and maps the stable results to the worker outcome (processed / retry /
 * dead-letter). Never touches the database directly, never creates or closes a
 * Pool, never copies retry budget / backoff / lease / store logic, and never
 * writes logs.
 */
export function createRequestEventProcessor(
  input: CreateRequestEventProcessorInput,
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
    // The request processor is synchronous with the store calls and does not
    // need the abort signal for cooperative cancellation; the runtime owns
    // shutdown. The eventType guard below is a local precondition, NOT the
    // final routing policy for non-request events (that remains blocked).
    void signal;
    const eventType = processorInput.event.eventType;
    if (eventType !== 'request') {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }

    const parseResult = parseRequestEventEnvelope(processorInput.event);
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

    const classification = await input.classify({
      outcome: envelope.body.outcome,
      ...(envelope.body.statusCode !== undefined ? { statusCode: envelope.body.statusCode } : {}),
      durationMs: envelope.body.durationMs,
      method: envelope.body.method,
    });

    const metricResult = await input.persistMetric({
      projectId: processorInput.projectId,
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
      method: envelope.body.method,
      outcome: envelope.body.outcome,
      ...(envelope.body.statusCode !== undefined ? { statusCode: envelope.body.statusCode } : {}),
      durationMs: envelope.body.durationMs,
      isFailure: classification.isFailure,
      isSlow: classification.isSlow,
    });

    if (metricResult.status === 'temporarily_unavailable') {
      return computeRetry(processorInput.inboxId, eventType, processorInput.attemptCount);
    }
    const metricMapping = mapMetricResultToContinuation(metricResult);
    if (metricMapping.status === 'dead-letter') {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: metricMapping.errorCode };
    }
    diagnostics.record({
      code: metricResult.status === 'applied' ? 'metric_applied' : 'metric_duplicate',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });

    const selection = decideRequestSampleSelection({
      outcome: envelope.body.outcome,
      ...(envelope.body.statusCode !== undefined ? { statusCode: envelope.body.statusCode } : {}),
      isSlow: classification.isSlow,
      isAdditionalMonitoredStatus: classification.isAdditionalMonitoredStatus,
    });
    if (selection.decision === 'invalid') {
      // Program defect: the processor produced an invalid selection input. Do
      // not silently downgrade; let the worker runtime treat this as an
      // unclassified processor failure (ADR-015).
      throw new Error('invalid request sample selection input');
    }
    if (selection.decision === 'skip') {
      return { outcome: 'processed' };
    }

    const sampleResult = await input.persistSample({
      projectId: processorInput.projectId,
      eventEnvelope: processorInput.event,
    });
    if (sampleResult.status === 'temporarily_unavailable') {
      return computeRetry(processorInput.inboxId, eventType, processorInput.attemptCount);
    }
    const sampleMapping = mapSampleResultToWorkerResult(sampleResult);
    diagnostics.record({
      code: sampleResult.status === 'inserted' ? 'sample_inserted' : 'sample_duplicate',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });
    return sampleMapping;
  };

  return { process };
}
