/** Input to a single dead-letter manual replay command. */
export interface ReplayDeadLetteredEventInput {
  readonly projectId: string;
  readonly inboxId: number;
  readonly operationId: string;
  readonly requestedAt: Date;
}

/**
 * Stable discriminable result of a manual replay. Success carries the new
 * replay generation and the resulting availableAt. Failures are stable statuses;
 * the function never exposes database error details, database names, or SQL text.
 */
export type ReplayDeadLetteredEventResult =
  | {
      readonly status: 'replayed';
      readonly replayGeneration: number;
      readonly availableAt: Date;
    }
  | {
      readonly status: 'already_replayed';
      readonly replayGeneration: number;
      readonly availableAt: Date;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'invalid_state'; readonly currentState: string }
  | { readonly status: 'operation_conflict' };

/** Replay repository over the durable Inbox. */
export interface IngestionInboxReplayRepository {
  replayDeadLettered(input: ReplayDeadLetteredEventInput): Promise<ReplayDeadLetteredEventResult>;
}
