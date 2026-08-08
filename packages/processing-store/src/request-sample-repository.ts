import type { Pool, PoolClient } from 'pg';
import { parsePersistRequestEventSampleInput } from './request-sample-input.js';
import type { PersistRequestEventSampleResult } from './request-sample-types.js';

const INSERT_SQL = `
  INSERT INTO request_event_samples
    (project_id, event_id, protocol_version, occurred_at, sample_body)
  VALUES
    ($1, $2, $3, $4, $5::jsonb)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING id
`;

/**
 * Persist one validated request event safe sample within a single committed
 * transaction. Idempotency is enforced by the (project_id, event_id) unique key
 * via ON CONFLICT DO NOTHING: first write -> inserted, repeat write -> duplicate.
 * Never exposes the pg Result object or internal database error details to the
 * caller. A sample is a bounded diagnostic projection, not a complete request
 * occurrence history.
 */
export async function persistRequestEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestEventSampleResult> {
  const parsed = parsePersistRequestEventSampleInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(INSERT_SQL, [
      parsed.projectId,
      parsed.eventId,
      parsed.protocolVersion,
      parsed.occurredAtIso,
      JSON.stringify(parsed.sampleBody),
    ]);
    await client.query('COMMIT');
    if (result.rows.length === 0) return { status: 'duplicate' };
    return { status: 'inserted', sampleId: result.rows[0]?.id ?? '' };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // Never leak database error details to the caller.
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
