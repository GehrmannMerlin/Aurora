import type { EventEnvelope } from '@aurora/event-schema';

/**
 * One event in a batch to persist. The envelope must already have passed the
 * @aurora/event-schema public parser before reaching the repository.
 */
export interface InboxEventInput {
  readonly batchIndex: number;
  readonly event: EventEnvelope;
}

/** Input to persistBatch: trusted project context + schema-validated events. */
export interface PersistIngestionBatchInput {
  readonly projectId: string;
  readonly events: readonly InboxEventInput[];
  readonly receivedAt?: number;
  readonly requestId?: string;
  readonly batchId?: string;
}

/** Per-event persistence outcome, mappable to IngestionEventReceipt by a future ingestion service. */
export interface InboxEventPersistResult {
  readonly eventId: string;
  readonly outcome: 'inserted' | 'duplicate';
}

/** Result of persisting a batch inside a single committed transaction. */
export interface PersistIngestionBatchResult {
  readonly perEventResults: readonly InboxEventPersistResult[];
}
