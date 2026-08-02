import type { EventEnvelope } from '@aurora/event-schema';
import type { IngestionErrorCode } from '@aurora/event-schema';

/** Input to claimAvailable: caller-provided bounds, no product defaults hard-coded. */
export interface ClaimAvailableInboxEventsInput {
  readonly limit: number;
  readonly leaseDurationMs: number;
  readonly workerId: string;
}

/** A record successfully claimed under a new processing lease. */
export interface ClaimedInboxEvent {
  readonly id: number;
  readonly projectId: string;
  readonly eventId: string;
  readonly event: EventEnvelope;
  readonly attemptCount: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: Date;
}

export type ClaimAvailableInboxEventsResult =
  | { readonly status: 'claimed'; readonly events: readonly ClaimedInboxEvent[] }
  | { readonly status: 'nothingToClaim' };

/** Input to renewLease: current lease must be valid and match leaseId. */
export interface RenewInboxLeaseInput {
  readonly id: number;
  readonly leaseId: string;
  readonly leaseDurationMs: number;
}

/** Input to markProcessed: current lease must be valid and match leaseId. */
export interface MarkInboxEventProcessedInput {
  readonly id: number;
  readonly leaseId: string;
}

/** Input to scheduleRetry: caller provides the next availableAt. */
export interface ScheduleInboxEventRetryInput {
  readonly id: number;
  readonly leaseId: string;
  readonly availableAt: Date;
  readonly errorCode?: IngestionErrorCode;
}

/** Input to markDeadLettered: current lease must be valid and match leaseId. */
export interface MarkInboxEventDeadLetteredInput {
  readonly id: number;
  readonly leaseId: string;
  readonly errorCode?: IngestionErrorCode;
}

export type InboxLeaseMutationResult =
  | { readonly status: 'success' }
  | { readonly status: 'lease_lost' }
  | { readonly status: 'not_found' };

/** Processing-side repository over the durable Inbox. */
export interface IngestionInboxProcessingRepository {
  claimAvailable(input: ClaimAvailableInboxEventsInput): Promise<ClaimAvailableInboxEventsResult>;

  renewLease(input: RenewInboxLeaseInput): Promise<InboxLeaseMutationResult>;

  markProcessed(input: MarkInboxEventProcessedInput): Promise<InboxLeaseMutationResult>;

  scheduleRetry(input: ScheduleInboxEventRetryInput): Promise<InboxLeaseMutationResult>;

  markDeadLettered(input: MarkInboxEventDeadLetteredInput): Promise<InboxLeaseMutationResult>;
}
