import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@aurora/event-schema';
import { eventEnvelopeToJson, jsonToEventEnvelope } from '../src/index.js';
import type {
  InboxEventInput,
  InboxEventPersistResult,
  PersistIngestionBatchInput,
  PersistIngestionBatchResult,
} from '../src/index.js';

const validEnvelope: EventEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-inbox-001',
  eventType: 'error',
  occurredAt: 1_800_000_000_000,
  body: {},
};

describe('ingestion-inbox types and row mapping', () => {
  it('exposes the public input and result shapes', () => {
    const eventInput: InboxEventInput = { batchIndex: 0, event: validEnvelope };
    const input: PersistIngestionBatchInput = {
      projectId: 'project-1',
      events: [eventInput],
      receivedAt: 1_800_000_000_500,
      requestId: 'req-1',
      batchId: 'batch-1',
    };
    expect(input.projectId).toBe('project-1');
    expect(input.events[0]?.event.eventId).toBe('evt-inbox-001');
  });

  it('restricts outcome to inserted | duplicate', () => {
    const inserted: InboxEventPersistResult = { eventId: 'a', outcome: 'inserted' };
    const duplicate: InboxEventPersistResult = { eventId: 'a', outcome: 'duplicate' };
    const result: PersistIngestionBatchResult = { perEventResults: [inserted, duplicate] };
    expect(result.perEventResults).toHaveLength(2);
  });

  it('round-trips an EventEnvelope through JSONB mapping without rewriting eventId', () => {
    const json = eventEnvelopeToJson(validEnvelope);
    expect(typeof json).toBe('string');
    const parsed = jsonToEventEnvelope(json) as EventEnvelope;
    expect(parsed).toEqual(validEnvelope);
    expect(parsed.eventId).toBe('evt-inbox-001');
  });

  it('throws a stable error for empty input arrays', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool();
    const { persistBatch } = await import('../src/index.js');
    await expect(persistBatch(pool, { projectId: 'p', events: [] })).rejects.toMatchObject({
      kind: 'invalid_input',
      message: 'empty batch',
    });
    await pool.end();
  });
});
