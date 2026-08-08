import type { Pool, PoolClient } from 'pg';
import { parsePersistPerformanceEventSampleInput } from './performance-sample-input.js';
import type { PersistPerformanceEventSampleResult } from './performance-sample-types.js';

const INSERT_SQL = `
  INSERT INTO performance_event_samples
    (project_id, event_id, occurred_at, sample_body)
  VALUES
    ($1, $2, $3, $4::jsonb)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING id
`;

/**
 * Persist one validated performance event safe sample within a single committed
 * transaction. Idempotency is enforced by the (project_id, event_id) unique key
 * via ON CONFLICT DO NOTHING: first write -> inserted, repeat write -> duplicate.
 * Never exposes the pg Result object or internal database error details. A
 * sample is a bounded diagnostic projection, not a complete performance history.
 */
export async function persistPerformanceEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistPerformanceEventSampleResult> {
  const parsed = parsePersistPerformanceEventSampleInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(INSERT_SQL, [
      parsed.projectId,
      parsed.eventId,
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
