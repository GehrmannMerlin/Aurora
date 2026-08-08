import type { Pool, PoolClient } from 'pg';
import { IngestionInboxError } from './errors.js';
import type {
  ReplayDeadLetteredEventInput,
  ReplayDeadLetteredEventResult,
} from './replay-types.js';

interface LockedRow {
  id: number;
  event_id: string;
  state: string;
  attempt_count: number;
  last_error_code: string | null;
  replay_generation: number;
}

interface OperationRow {
  operation_id: string;
  project_id: string;
  inbox_id: string;
  replay_generation: number;
  requested_at: string;
}

const LOCK_ROW_SQL = `
  SELECT id, event_id, state, attempt_count, last_error_code, replay_generation
  FROM event_inbox
  WHERE project_id = $1 AND id = $2
  FOR UPDATE
`;

const FIND_OPERATION_SQL = `
  SELECT operation_id, project_id, inbox_id, replay_generation, requested_at
  FROM event_inbox_replay_operations
  WHERE operation_id = $1
`;

const INSERT_OPERATION_SQL = `
  INSERT INTO event_inbox_replay_operations
    (operation_id, project_id, inbox_id, event_id, replay_generation,
     previous_attempt_count, previous_error_code, requested_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (operation_id) DO NOTHING
  RETURNING operation_id
`;

const UPDATE_REPLAYED_SQL = `
  UPDATE event_inbox
  SET state = 'pending',
      available_at = $3,
      attempt_count = 0,
      replay_generation = replay_generation + 1,
      lease_owner = NULL, lease_id = NULL, lease_expires_at = NULL,
      processed_at = NULL, dead_lettered_at = NULL,
      last_error_code = NULL
  WHERE project_id = $1 AND id = $2
  RETURNING replay_generation
`;

function validateInput(input: ReplayDeadLetteredEventInput): void {
  if (typeof input.projectId !== 'string' || input.projectId === '') {
    throw new IngestionInboxError('invalid_input', 'projectId must be a non-empty string');
  }
  if (!Number.isSafeInteger(input.inboxId) || input.inboxId <= 0) {
    throw new IngestionInboxError('invalid_input', 'inboxId must be a positive safe integer');
  }
  if (typeof input.operationId !== 'string' || input.operationId === '') {
    throw new IngestionInboxError('invalid_input', 'operationId must be a non-empty string');
  }
  if (!(input.requestedAt instanceof Date) || Number.isNaN(input.requestedAt.getTime())) {
    throw new IngestionInboxError('invalid_input', 'requestedAt must be a valid Date');
  }
}

function toReplayed(
  replayGeneration: number,
  requestedAt: Date,
): ReplayDeadLetteredEventResult {
  return {
    status: 'replayed',
    replayGeneration,
    availableAt: requestedAt,
  };
}

function toAlreadyReplayed(operation: OperationRow): ReplayDeadLetteredEventResult {
  return {
    status: 'already_replayed',
    replayGeneration: operation.replay_generation,
    availableAt: new Date(operation.requested_at),
  };
}

/** Map a duplicate operation to already_replayed or operation_conflict by target. */
function duplicateOperationResult(
  operation: OperationRow | undefined,
  input: ReplayDeadLetteredEventInput,
): ReplayDeadLetteredEventResult {
  if (operation !== undefined) {
    const sameTarget =
      operation.project_id === input.projectId &&
      Number(operation.inbox_id) === input.inboxId;
    if (sameTarget) return toAlreadyReplayed(operation);
    return { status: 'operation_conflict' };
  }
  // No existing operation row visible (e.g. a concurrent insert not yet
  // committed); conservatively report a conflict rather than a raw error.
  return { status: 'operation_conflict' };
}

/**
 * Manually replay a single dead-lettered Inbox event back to pending within one
 * transaction. Locks the row with FOR UPDATE, (re)checks operationId idempotency
 * after the lock, validates the current state is dead_lettered, writes a minimal
 * operation record, resets attempt_count, increments replay_generation, and
 * commits. Any failure rolls back the whole transaction. Never exposes database
 * error details, database names, or SQL text.
 */
export async function replayDeadLettered(
  pool: Pool,
  input: ReplayDeadLetteredEventInput,
): Promise<ReplayDeadLetteredEventResult> {
  validateInput(input);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the target Inbox row (scoped by projectId + inboxId). No cross-project updates.
    const lockResult = await client.query<LockedRow>(LOCK_ROW_SQL, [
      input.projectId,
      input.inboxId,
    ]);
    const row = lockResult.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK').catch(() => undefined);
      return { status: 'not_found' };
    }

    // Post-lock idempotency check: avoids the TOCTOU where two concurrent calls
    // with the same operationId both pass a pre-lock check.
    const existing = await client.query<OperationRow>(FIND_OPERATION_SQL, [input.operationId]);
    const existingOp = existing.rows[0];
    if (existingOp !== undefined) {
      const result = duplicateOperationResult(existingOp, input);
      await client.query('ROLLBACK').catch(() => undefined);
      return result;
    }

    if (row.state !== 'dead_lettered') {
      await client.query('ROLLBACK').catch(() => undefined);
      return { status: 'invalid_state', currentState: row.state };
    }

    // Insert the operation record first so its replay_generation is the new
    // value. ON CONFLICT handles the concurrent-same-operationId race.
    const newGeneration = row.replay_generation + 1;
    const inserted = await client.query<{ operation_id: string }>(INSERT_OPERATION_SQL, [
      input.operationId,
      input.projectId,
      input.inboxId,
      row.event_id,
      newGeneration,
      row.attempt_count,
      row.last_error_code,
      input.requestedAt.toISOString(),
    ]);
    if (inserted.rows.length === 0) {
      // A concurrent call with the same operationId won the insert; re-read to
      // map to already_replayed / operation_conflict rather than surfacing a
      // raw uniqueness failure to the caller.
      const conflict = await client.query<OperationRow>(FIND_OPERATION_SQL, [
        input.operationId,
      ]);
      const result = duplicateOperationResult(conflict.rows[0], input);
      await client.query('ROLLBACK').catch(() => undefined);
      return result;
    }

    const updated = await client.query<{ replay_generation: number }>(UPDATE_REPLAYED_SQL, [
      input.projectId,
      input.inboxId,
      input.requestedAt.toISOString(),
    ]);
    const updatedRow = updated.rows[0];
    if (updatedRow === undefined) {
      await client.query('ROLLBACK').catch(() => undefined);
      return { status: 'not_found' };
    }

    await client.query('COMMIT');
    return toReplayed(updatedRow.replay_generation, input.requestedAt);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw toStableError(error);
  } finally {
    client.release();
  }
}

function toStableError(error: unknown): IngestionInboxError {
  if (error instanceof IngestionInboxError) return error;
  const code = (() => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const value = (error as { code?: unknown }).code;
      return typeof value === 'string' ? value : '';
    }
    return '';
  })();
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new IngestionInboxError('database_unavailable', 'database is unavailable');
  }
  return new IngestionInboxError('statement_failed', 'database statement failed');
}
