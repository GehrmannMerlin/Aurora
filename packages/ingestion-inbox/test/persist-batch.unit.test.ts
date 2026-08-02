import { describe, expect, it } from 'vitest';
import { IngestionInboxError } from '../src/index.js';
import { eventEnvelopeToJson } from '../src/index.js';
import type { EventEnvelope } from '@aurora/event-schema';

const validEnvelope: EventEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-unit-001',
  eventType: 'error',
  occurredAt: 1_800_000_000_000,
  body: {},
};

describe('persistBatch input validation (no database)', () => {
  it('rejects an empty batch with a stable invalid_input error', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const { persistBatch } = await import('../src/index.js');
    await expect(persistBatch(pool, { projectId: 'p', events: [] })).rejects.toMatchObject({
      kind: 'invalid_input',
      message: 'empty batch',
    });
    await pool.end();
  });

  it('rejects an empty projectId with a stable invalid_input error', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const { persistBatch } = await import('../src/index.js');
    await expect(
      persistBatch(pool, { projectId: '', events: [{ batchIndex: 0, event: validEnvelope }] }),
    ).rejects.toMatchObject({ kind: 'invalid_input', message: 'projectId must not be empty' });
    await pool.end();
  });

  it('rejects a non-safe-integer receivedAt', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const { persistBatch } = await import('../src/index.js');
    await expect(
      persistBatch(pool, {
        projectId: 'p',
        events: [{ batchIndex: 0, event: validEnvelope }],
        receivedAt: -1,
      }),
    ).rejects.toMatchObject({ kind: 'invalid_input' });
    await pool.end();
  });

  it('serializes envelopes deterministically without rewriting eventId', () => {
    const json = eventEnvelopeToJson(validEnvelope);
    const parsed = JSON.parse(json) as EventEnvelope;
    expect(parsed.eventId).toBe('evt-unit-001');
    expect(parsed).toEqual(validEnvelope);
  });

  it('defines IngestionInboxError with a stable kind and no SQL fields', () => {
    const err = new IngestionInboxError('statement_failed', 'database statement failed');
    expect(err.kind).toBe('statement_failed');
    expect(JSON.stringify(err)).not.toContain('SQLSTATE');
    expect(JSON.stringify(err)).not.toContain('constraint');
  });
});
