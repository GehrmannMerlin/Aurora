import type { Pool, PoolClient } from 'pg';
import { parsePersistErrorEventOccurrenceInput } from './error-occurrence-input.js';
import type { PersistErrorEventOccurrenceResult } from './error-occurrence-types.js';

const INSERT_SQL = `
  INSERT INTO error_event_occurrences
    (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body)
  VALUES
    ($1, $2, $3, $4, $5, $6::jsonb)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING id
`;

/**
 * Persist one validated error event occurrence within a single committed
 * transaction. Idempotency is enforced by the (project_id, event_id) unique
 * key via ON CONFLICT DO NOTHING: first write -> inserted, repeat write
 * -> duplicate. Never exposes the pg Result object or internal database
 * error details to the caller.
 */
export async function persistErrorEventOccurrence(
  pool: Pool,
  input: unknown,
): Promise<PersistErrorEventOccurrenceResult> {
  const parsed = parsePersistErrorEventOccurrenceInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(INSERT_SQL, [
      parsed.projectId,
      parsed.eventId,
      parsed.protocolVersion,
      parsed.occurredAtIso,
      parsed.errorCategory,
      JSON.stringify(parsed.normalizedBody),
    ]);
    await client.query('COMMIT');
    if (result.rows.length === 0) return { status: 'duplicate' };
    return { status: 'inserted', occurrenceId: result.rows[0]?.id ?? '' };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // Never leak database error details to the caller.
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
