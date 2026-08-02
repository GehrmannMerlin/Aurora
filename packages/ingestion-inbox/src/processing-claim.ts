import type { Pool, PoolClient } from 'pg';
import { IngestionInboxError } from './errors.js';
import { jsonToEventEnvelope } from './event-inbox-row.js';
import type {
  ClaimAvailableInboxEventsInput,
  ClaimAvailableInboxEventsResult,
  ClaimedInboxEvent,
} from './processing-types.js';

export const MAX_CLAIM_LIMIT = 100;

interface ClaimRow {
  id: number;
  project_id: string;
  event_id: string;
  envelope: string;
  attempt_count: number;
  lease_id: string;
  lease_expires_at: string;
}

function validateClaimInput(input: ClaimAvailableInboxEventsInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_CLAIM_LIMIT) {
    throw new IngestionInboxError(
      'invalid_input',
      `limit must be an integer in 1..${String(MAX_CLAIM_LIMIT)}`,
    );
  }
  if (!Number.isSafeInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
    throw new IngestionInboxError('invalid_input', 'leaseDurationMs must be a positive integer');
  }
  if (input.workerId.length === 0) {
    throw new IngestionInboxError('invalid_input', 'workerId must not be empty');
  }
}

export const CLAIM_SQL = `
  WITH candidates AS (
    SELECT id FROM event_inbox
    WHERE (state IN ('pending', 'retry_waiting') AND available_at <= now())
       OR (state = 'leased' AND lease_expires_at <= now())
    ORDER BY id
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE event_inbox ei
  SET state = 'leased',
      lease_id = gen_random_uuid(),
      lease_owner = $2,
      lease_expires_at = now() + ($3 * interval '1 millisecond'),
      attempt_count = attempt_count + 1
  FROM candidates c
  WHERE ei.id = c.id
  RETURNING ei.id, ei.project_id, ei.event_id, ei.envelope,
            ei.attempt_count, ei.lease_id, ei.lease_expires_at
`;

export async function claimAvailable(
  pool: Pool | PoolClient,
  input: ClaimAvailableInboxEventsInput,
): Promise<ClaimAvailableInboxEventsResult> {
  validateClaimInput(input);
  const result = await pool.query<ClaimRow>(CLAIM_SQL, [
    input.limit,
    input.workerId,
    input.leaseDurationMs,
  ]);
  if (result.rows.length === 0) {
    return { status: 'nothingToClaim' };
  }
  const events: ClaimedInboxEvent[] = result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    eventId: row.event_id,
    event: jsonToEventEnvelope(row.envelope) as ClaimedInboxEvent['event'],
    attemptCount: row.attempt_count,
    leaseId: row.lease_id,
    leaseExpiresAt: new Date(row.lease_expires_at),
  }));
  return { status: 'claimed', events };
}
