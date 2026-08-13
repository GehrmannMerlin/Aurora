import { parseErrorEventEnvelope, type IngestionErrorCode } from '@aurora/event-schema';
import {
  computeErrorFingerprint,
  type IssueNotificationSender,
  type PersistErrorEventOccurrenceResult,
  type PersistIssueContributionInput,
  type PersistIssueContributionResult,
} from '@aurora/processing-store';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';
import { calculateRetryBackoffSchedule } from './retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider } from './retry-backoff-entropy.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';

/** Stable diagnostic facts emitted by the error processor; never carries the event body. */
export interface ErrorEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

/** Optional bounded diagnostics port. */
export interface ErrorEventProcessorDiagnostics {
  record(diagnostic: ErrorEventProcessorDiagnostic): void;
}

/** Inject the processing-store root persistence function or a compatible fake. */
export type PersistErrorEventOccurrenceFn = (input: {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
  /** DAT-12 group key computed by this processor (store validates + persists). */
  readonly fingerprint?: string;
  readonly fingerprintVersion?: number;
}) => Promise<PersistErrorEventOccurrenceResult>;

export interface CreateErrorEventProcessorInput {
  readonly persist: PersistErrorEventOccurrenceFn;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: ErrorEventProcessorDiagnostics;
  /**
   * DAT-13 Issue aggregate contribution, injectable. Default no-op keeps the
   * processor backward-compatible (DAT-12 behavior); the real
   * `@aurora/processing-store` `persistIssueContribution` is injected by the
   * production composition root / integration tests.
   */
  readonly contributeIssue?: (
    input: PersistIssueContributionInput,
  ) => Promise<PersistIssueContributionResult>;
  /**
   * PLT-09 issue-trigger notification sender, injectable. Default no-op keeps
   * the processor DB-free and backward-compatible; the real
   * `@aurora/processing-store` `createIssueNotificationSender` is injected when
   * wired. Called only after a contribution reports `inserted` (new issue) or
   * `reopened` (issue reappeared) — append-only, never changes the outcome.
   */
  readonly notifyIssue?: IssueNotificationSender;
}

const NOOP_DIAGNOSTICS: ErrorEventProcessorDiagnostics = {
  record: () => undefined,
};

/**
 * Map a processing-store persistence result to the worker processed / dead-letter
 * outcome. inserted and duplicate are idempotent success; invalid_input is a
 * permanent rejection (SDK must not retry). temporarily_unavailable is handled
 * by the factory (it needs backoff) and throws as a program-defect branch here.
 */
export function mapPersistResultToWorkerResult(
  result: PersistErrorEventOccurrenceResult,
):
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode } {
  if (result.status === 'inserted' || result.status === 'duplicate') {
    return { outcome: 'processed' };
  }
  if (result.status === 'invalid_input') {
    return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
  }
  // temporarily_unavailable is a temporary outcome, not a terminal mapping.
  throw new Error('temporarily_unavailable is not a terminal worker outcome');
}

/**
 * Create a concrete error event processor. It accepts the worker processing
 * input, validates that the envelope is an error event, persists the occurrence
 * through the injected processing-store root function, and maps the stable
 * result to the worker outcome (processed / retry / dead-letter). Never touches
 * the database directly, never creates or closes a Pool, never copies retry
 * budget / backoff / lease logic, and never writes logs.
 */
export function createErrorEventProcessor(
  input: CreateErrorEventProcessorInput,
): IngestionEventProcessor {
  const calculateBackoff = input.calculateBackoff ?? calculateRetryBackoffSchedule;
  const entropyProvider = input.entropyProvider ?? createNodeCryptoEntropyProvider();
  const now = input.now ?? (() => new Date());
  const diagnostics = input.diagnostics ?? NOOP_DIAGNOSTICS;
  // DAT-13: default no-op keeps the processor backward-compatible (DAT-12
  // behavior); the real persistIssueContribution is injected when wired.
  const contributeIssue =
    input.contributeIssue ??
    ((): Promise<PersistIssueContributionResult> => Promise.resolve({ status: 'duplicate' }));
  // PLT-09: default no-op keeps the processor DB-free; the real
  // createIssueNotificationSender is injected when wired.
  const notifyIssue = input.notifyIssue ?? (async (): Promise<void> => undefined);

  const process = async (
    processorInput: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult> => {
    // The error processor is synchronous with the store call and does not need
    // the abort signal for cooperative cancellation; the runtime owns shutdown.
    void signal;
    const eventType = processorInput.event.eventType;
    if (eventType !== 'error') {
      // Local precondition: this processor only handles error events. This is
      // NOT the final routing policy for non-error events (that remains blocked).
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }

    const retryWithBackoff = (): Promise<ProcessIngestionEventResult> => {
      const backoffResult = calculateBackoff({
        config: input.backoff,
        attemptCount: processorInput.attemptCount,
        now: now(),
        entropy: entropyProvider.next(),
      });
      if (backoffResult.status !== 'success') {
        // Program defect: the caller supplied an invalid backoff configuration.
        // Do not silently downgrade to a business retry; let the worker runtime
        // treat this as an unclassified processor failure (ADR-015).
        throw new Error('invalid retry backoff configuration');
      }
      diagnostics.record({
        code: 'temporarily_unavailable',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return Promise.resolve({
        outcome: 'retry',
        availableAt: backoffResult.availableAt,
        errorCode: 'service_temporarily_unavailable',
      });
    };

    // DAT-12/13: parse the envelope, compute the stable fingerprint (single
    // computation point reused for both the occurrence key and the Issue
    // aggregate key), and build the Issue contribution input. On a parse
    // failure (should not occur after Inbox validation) the store's own
    // validation still dead-letters the occurrence.
    let contributionInput: PersistIssueContributionInput | undefined;
    const parsed = parseErrorEventEnvelope(processorInput.event);
    if (parsed.success) {
      const fingerprint = computeErrorFingerprint({
        projectId: processorInput.projectId,
        body: parsed.data.body,
      });
      contributionInput = {
        projectId: processorInput.projectId,
        fingerprint: fingerprint.fingerprint,
        fingerprintVersion: fingerprint.fingerprintVersion,
        category: parsed.data.body.category,
        normalizedTitle: fingerprint.normalizedTitle,
        eventId: parsed.data.eventId,
        occurredAtIso: new Date(parsed.data.occurredAt).toISOString(),
        sampleBody: parsed.data.body,
      };
    }

    const result = await input.persist({
      projectId: processorInput.projectId,
      eventEnvelope: processorInput.event,
      ...(contributionInput === undefined
        ? {}
        : {
            fingerprint: contributionInput.fingerprint,
            fingerprintVersion: contributionInput.fingerprintVersion,
          }),
    });

    if (result.status === 'invalid_input') {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }
    if (result.status === 'temporarily_unavailable') {
      return await retryWithBackoff();
    }

    // Occurrence persisted (inserted or duplicate): contribute to the Issue
    // aggregate (DAT-13). Cross-store convergence relies on the contribution's
    // own (project_id, event_id) event-application idempotency, so a retried
    // contribution never double-counts.
    if (contributionInput !== undefined) {
      const contribution = await contributeIssue(contributionInput);
      if (contribution.status === 'invalid_input') {
        diagnostics.record({
          code: 'permanently_rejected_invalid_input',
          inboxId: processorInput.inboxId,
          eventType,
          attemptCount: processorInput.attemptCount,
        });
        return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
      }
      if (contribution.status === 'temporarily_unavailable') {
        return await retryWithBackoff();
      }
      // PLT-09: append a new_issue / issue_reappeared notification for project
      // admins (append-only; the processor outcome is unchanged). The injected
      // sender owns recipient resolution and dedupe.
      if (contribution.status === 'inserted') {
        await notifyIssue({
          projectId: processorInput.projectId,
          issueId: contribution.issueId,
          kind: 'new_issue',
        });
      } else if (contribution.status === 'reopened') {
        await notifyIssue({
          projectId: processorInput.projectId,
          issueId: contribution.issueId,
          kind: 'issue_reappeared',
        });
      }
    }

    diagnostics.record({
      code: result.status === 'inserted' ? 'occurrence_persisted' : 'occurrence_duplicate',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });
    return { outcome: 'processed' };
  };

  return { process };
}
