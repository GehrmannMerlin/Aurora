/** The five states the `event_inbox` state machine may report. */
export const INBOX_DIAGNOSTIC_STATES = [
  'pending',
  'leased',
  'retry_waiting',
  'processed',
  'dead_lettered',
] as const;

export type InboxDiagnosticState = (typeof INBOX_DIAGNOSTIC_STATES)[number];

/**
 * Read-only per-project diagnostic projection over `event_inbox`. State counts
 * are factual counts inside the queried `received_at` window: a missing state
 * means zero rows in that state, not missing data. Timestamps are RFC 3339 UTC,
 * or null when the window holds no relevant row. `lastErrorCode` is the stable
 * error code of the newest dead-lettered row (by `dead_lettered_at`), or null.
 */
export interface ProjectInboxDiagnostics {
  readonly byState: {
    readonly pending: number;
    readonly leased: number;
    readonly retry_waiting: number;
    readonly processed: number;
    readonly dead_lettered: number;
  };
  readonly latestReceivedAt: string | null;
  readonly latestProcessedAt: string | null;
  readonly latestDeadLetteredAt: string | null;
  readonly lastErrorCode: string | null;
}
