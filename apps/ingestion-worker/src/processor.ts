import type { EventEnvelope, IngestionErrorCode } from '@aurora/event-schema';

/** Stable data a processor needs to handle one Inbox event. No rows, SQL, or secrets. */
export interface ProcessIngestionEventInput {
  readonly inboxId: number;
  readonly projectId: string;
  readonly eventId: string;
  readonly event: EventEnvelope;
  readonly attemptCount: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: Date;
}

/** Only the three explicit outcomes are allowed; retry/dead-letter must carry a stable error code. */
export type ProcessIngestionEventResult =
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'retry'; readonly availableAt: Date; readonly errorCode: IngestionErrorCode }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode };

/** Minimal processor port. The runtime never decides retry/dead-letter on its own. */
export interface IngestionEventProcessor {
  process(
    input: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult>;
}
