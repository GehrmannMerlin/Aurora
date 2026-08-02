import type { Pool, PoolClient } from 'pg';
import { leaseLostResult, successResult } from './processing-errors.js';
import type {
  InboxLeaseMutationResult,
  MarkInboxEventDeadLetteredInput,
  MarkInboxEventProcessedInput,
  RenewInboxLeaseInput,
  ScheduleInboxEventRetryInput,
} from './processing-types.js';

const RENEW_SQL = `
  UPDATE event_inbox
  SET lease_expires_at = now() + ($3 * interval '1 millisecond')
  WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
  RETURNING id
`;

const MARK_PROCESSED_SQL = `
  UPDATE event_inbox
  SET state = 'processed',
      processed_at = now(),
      lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
      last_error_code = NULL
  WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
  RETURNING id
`;

const SCHEDULE_RETRY_SQL = `
  UPDATE event_inbox
  SET state = 'retry_waiting',
      available_at = $3,
      lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
      last_error_code = $4
  WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
  RETURNING id
`;

const MARK_DEAD_LETTERED_SQL = `
  UPDATE event_inbox
  SET state = 'dead_lettered',
      dead_lettered_at = now(),
      lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
      last_error_code = $3
  WHERE id = $1 AND state = 'leased' AND lease_id = $2 AND lease_expires_at > now()
  RETURNING id
`;

/** Only the current valid lease may extend; attempt_count is unchanged. */
export async function renewLease(
  pool: Pool | PoolClient,
  input: RenewInboxLeaseInput,
): Promise<InboxLeaseMutationResult> {
  if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    return leaseLostResult();
  }
  const result = await pool.query(RENEW_SQL, [input.id, input.leaseId, input.leaseDurationMs]);
  if (result.rows.length === 0) return leaseLostResult();
  return successResult();
}

/** Atomically mark processed, clearing lease fields. Never repeats success for an old lease. */
export async function markProcessed(
  pool: Pool | PoolClient,
  input: MarkInboxEventProcessedInput,
): Promise<InboxLeaseMutationResult> {
  const result = await pool.query(MARK_PROCESSED_SQL, [input.id, input.leaseId]);
  if (result.rows.length === 0) return leaseLostResult();
  return successResult();
}

/** Schedule a later retry; caller provides availableAt. Clears lease fields. */
export async function scheduleRetry(
  pool: Pool | PoolClient,
  input: ScheduleInboxEventRetryInput,
): Promise<InboxLeaseMutationResult> {
  const result = await pool.query(SCHEDULE_RETRY_SQL, [
    input.id,
    input.leaseId,
    input.availableAt.toISOString(),
    input.errorCode ?? null,
  ]);
  if (result.rows.length === 0) return leaseLostResult();
  return successResult();
}

/** Atomically mark dead-lettered, clearing lease fields. */
export async function markDeadLettered(
  pool: Pool | PoolClient,
  input: MarkInboxEventDeadLetteredInput,
): Promise<InboxLeaseMutationResult> {
  const result = await pool.query(MARK_DEAD_LETTERED_SQL, [
    input.id,
    input.leaseId,
    input.errorCode ?? null,
  ]);
  if (result.rows.length === 0) return leaseLostResult();
  return successResult();
}
