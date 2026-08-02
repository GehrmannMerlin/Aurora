import { describe, expect, it } from 'vitest';
import { CLAIM_SQL, MAX_CLAIM_LIMIT } from '../src/processing-claim.js';
import { IngestionInboxError } from '../src/index.js';
import { claimAvailable } from '../src/processing-claim.js';
import type { Pool } from 'pg';

describe('ingestion-inbox processing claim SQL and validation', () => {
  it('uses FOR UPDATE SKIP LOCKED and increments attempt_count', () => {
    expect(CLAIM_SQL).toContain('FOR UPDATE SKIP LOCKED');
    expect(CLAIM_SQL).toContain('attempt_count = attempt_count + 1');
    expect(CLAIM_SQL).toContain('lease_id = gen_random_uuid()');
    expect(CLAIM_SQL).toContain('now() + ($3 * interval');
  });

  it('rejects an out-of-range limit before touching the database', async () => {
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;
    await expect(
      claimAvailable(pool, { limit: 0, leaseDurationMs: 30_000, workerId: 'w' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await expect(
      claimAvailable(pool, { limit: MAX_CLAIM_LIMIT + 1, leaseDurationMs: 30_000, workerId: 'w' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('rejects a non-positive leaseDurationMs', async () => {
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;
    await expect(
      claimAvailable(pool, { limit: 1, leaseDurationMs: 0, workerId: 'w' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('rejects an empty workerId', async () => {
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;
    await expect(
      claimAvailable(pool, { limit: 1, leaseDurationMs: 30_000, workerId: '' }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('defines IngestionInboxError with stable kinds and no SQL fields', () => {
    const err = new IngestionInboxError('invalid_input', 'bad input');
    expect(err.kind).toBe('invalid_input');
    expect(JSON.stringify(err)).not.toContain('SQLSTATE');
    expect(JSON.stringify(err)).not.toContain('constraint');
  });
});
