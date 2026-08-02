import type { Pool, PoolClient } from 'pg';
import { IngestionInboxError } from './errors.js';
import { eventEnvelopeToJson } from './event-inbox-row.js';
import type {
  InboxEventPersistResult,
  PersistIngestionBatchInput,
  PersistIngestionBatchResult,
} from './types.js';

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

function receivedAtToIso(receivedAt: number | undefined): string {
  if (receivedAt === undefined) return new Date().toISOString();
  if (!Number.isSafeInteger(receivedAt) || receivedAt <= 0) {
    throw new IngestionInboxError('invalid_input', 'receivedAt must be a positive safe integer');
  }
  return new Date(receivedAt).toISOString();
}

const INSERT_SQL = `
  INSERT INTO event_inbox
    (project_id, event_id, event_type, protocol_version, envelope,
     batch_index, received_at, available_at, created_at, updated_at)
  VALUES
    ($1, $2, $3, $4, $5::jsonb, $6, $7, $7, now(), now())
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING event_id
`;

export async function persistBatch(
  pool: Pool,
  input: PersistIngestionBatchInput,
): Promise<PersistIngestionBatchResult> {
  if (input.events.length === 0) {
    throw new IngestionInboxError('invalid_input', 'empty batch');
  }
  if (input.projectId.length === 0) {
    throw new IngestionInboxError('invalid_input', 'projectId must not be empty');
  }

  const receivedAt = receivedAtToIso(input.receivedAt);
  const client: PoolClient = await pool.connect();
  const insertedIds = new Set<string>();
  try {
    await client.query('BEGIN');
    for (const eventInput of input.events) {
      const event = eventInput.event;
      const result = await client.query<{ event_id: string }>(INSERT_SQL, [
        input.projectId,
        event.eventId,
        event.eventType,
        event.protocolVersion,
        eventEnvelopeToJson(event),
        eventInput.batchIndex,
        receivedAt,
      ]);
      for (const row of result.rows) insertedIds.add(row.event_id);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw toStableError(error);
  } finally {
    client.release();
  }

  const perEventResults: InboxEventPersistResult[] = input.events.map((eventInput) => ({
    eventId: eventInput.event.eventId,
    outcome: insertedIds.has(eventInput.event.eventId) ? 'inserted' : 'duplicate',
  }));

  return { perEventResults };
}
