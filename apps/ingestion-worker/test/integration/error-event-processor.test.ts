import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeErrorFingerprint,
  persistErrorEventOccurrence,
  persistIssueContribution,
} from '@aurora/processing-store';
import { createErrorEventProcessor } from '../../src/error-event-processor.js';
import type { ProcessIngestionEventInput } from '../../src/processor.js';
import {
  assertIsTestDatabase,
  clearEventInbox,
  createTestPool,
  ensureErrorOccurrenceTable,
  migrateUp,
  queryRow,
  queryRows,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

interface OccurrenceRow {
  id: string;
  project_id: string;
  event_id: string;
  protocol_version: number;
  error_category: string;
  fingerprint: string;
  fingerprint_version: number;
}

function errorEnvelope(eventId: string): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt: 1_800_000_000_000,
    body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
  };
}

function requestEnvelope(eventId: string): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'request',
    occurredAt: 1_800_000_000_000,
    body: {
      method: 'GET',
      url: 'https://api.example.test/items',
      startedAt: 1_800_000_000_000,
      durationMs: 120,
      outcome: 'success',
    },
  };
}

function processorInput(
  inboxId: number,
  projectId: string,
  eventId: string,
  event: unknown,
): ProcessIngestionEventInput {
  return {
    inboxId,
    projectId,
    eventId,
    event: event as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-03T00:01:00.000Z'),
  };
}

describeDb('error event processor (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureErrorOccurrenceTable();
    await pool.query('DELETE FROM issue_samples');
    await pool.query('DELETE FROM issue_event_applications');
    await pool.query('DELETE FROM issues');
    await pool.query('DELETE FROM error_event_occurrences');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM issue_samples').catch(() => undefined);
    await pool.query('DELETE FROM issue_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM issues').catch(() => undefined);
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  it('persists one occurrence and maps to processed on first insert', async () => {
    const processor = createErrorEventProcessor({
      persist: (input) => persistErrorEventOccurrence(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    });
    const result = await processor.process(
      processorInput(1, projectA, 'pg-proc-js-1', errorEnvelope('pg-proc-js-1')),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });

    const row = await queryRow<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'pg-proc-js-1'`,
    );
    expect(row?.project_id).toBe(projectA);
    expect(row?.protocol_version).toBe(1);
    expect(row?.error_category).toBe('javascript');
  });

  it('creates an Issue aggregate and first sample through the real contribution', async () => {
    const processor = createErrorEventProcessor({
      persist: (input) => persistErrorEventOccurrence(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      contributeIssue: (input) => persistIssueContribution(pool, input),
    });
    const eventId = 'pg-issue-fp-1';
    const result = await processor.process(
      processorInput(6, projectA, eventId, errorEnvelope(eventId)),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });

    const issue = await queryRow<{
      occurrence_count: string;
      sample_count: number;
      status: string;
    }>(pool, `SELECT occurrence_count, sample_count, status FROM issues WHERE project_id = $1`, [
      projectA,
    ]);
    expect(issue?.occurrence_count).toBe('1');
    expect(issue?.sample_count).toBe(1);
    expect(issue?.status).toBe('open');
    const sample = await queryRow<{ sample_kind: string }>(
      pool,
      `SELECT sample_kind FROM issue_samples WHERE project_id = $1 AND event_id = $2`,
      [projectA, eventId],
    );
    expect(sample?.sample_kind).toBe('first');
    const application = await queryRow<{ event_id: string }>(
      pool,
      `SELECT event_id FROM issue_event_applications WHERE project_id = $1 AND event_id = $2`,
      [projectA, eventId],
    );
    expect(application?.event_id).toBe(eventId);
  });

  it('aggregates distinct events of the same fingerprint without duplicating on replay', async () => {
    const makeProcessor = () =>
      createErrorEventProcessor({
        persist: (input) => persistErrorEventOccurrence(pool, input),
        backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
        contributeIssue: (input) => persistIssueContribution(pool, input),
      });
    const envelopeFor = (eventId: string) => ({
      protocolVersion: 1,
      eventId,
      eventType: 'error' as const,
      occurredAt: 1_800_000_000_100,
      body: { category: 'javascript', error: { message: 'Distinct aggregate message' } },
    });

    // Isolated on projectB so this test does not collide with the other tests.
    // Two distinct events of the same fingerprint -> one Issue, count = 2.
    await makeProcessor().process(
      processorInput(7, projectB, 'pg-issue-fp-a', envelopeFor('pg-issue-fp-a')),
      new AbortController().signal,
    );
    await makeProcessor().process(
      processorInput(7, projectB, 'pg-issue-fp-b', envelopeFor('pg-issue-fp-b')),
      new AbortController().signal,
    );

    const issue = await queryRow<{ occurrence_count: string; sample_count: number }>(
      pool,
      `SELECT occurrence_count, sample_count FROM issues WHERE project_id = $1 AND normalized_title = 'Distinct aggregate message'`,
      [projectB],
    );
    expect(issue?.occurrence_count).toBe('2');
    expect(issue?.sample_count).toBe(2);
    const applications = await queryRow<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM issue_event_applications WHERE project_id = $1`,
      [projectB],
    );
    expect(applications?.count).toBe('2');
    const samples = await queryRow<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM issue_samples WHERE project_id = $1`,
      [projectB],
    );
    expect(samples?.count).toBe('2');

    // Replaying the first event neither increments the count nor duplicates.
    await makeProcessor().process(
      processorInput(7, projectB, 'pg-issue-fp-a', envelopeFor('pg-issue-fp-a')),
      new AbortController().signal,
    );
    const afterReplay = await queryRow<{ occurrence_count: string }>(
      pool,
      `SELECT occurrence_count FROM issues WHERE project_id = $1 AND normalized_title = 'Distinct aggregate message'`,
      [projectB],
    );
    expect(afterReplay?.occurrence_count).toBe('2');
  });

  it('persists the DAT-12 fingerprint computed by the processor', async () => {
    const processor = createErrorEventProcessor({
      persist: (input) => persistErrorEventOccurrence(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    });
    const result = await processor.process(
      processorInput(5, projectA, 'pg-proc-fp-1', errorEnvelope('pg-proc-fp-1')),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });

    const row = await queryRow<OccurrenceRow>(
      pool,
      `SELECT fingerprint, fingerprint_version FROM error_event_occurrences WHERE event_id = 'pg-proc-fp-1'`,
    );
    const expected = computeErrorFingerprint({
      projectId: projectA,
      body: (
        errorEnvelope('pg-proc-fp-1') as { body: Parameters<typeof computeErrorFingerprint>[0]['body'] }
      ).body,
    });
    expect(row?.fingerprint).toBe(expected.fingerprint);
    expect(row?.fingerprint_version).toBe(1);
  });

  it('treats a duplicate occurrence as idempotent success', async () => {
    const processor = createErrorEventProcessor({
      persist: (input) => persistErrorEventOccurrence(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    });
    const first = await processor.process(
      processorInput(2, projectA, 'pg-proc-dup-1', errorEnvelope('pg-proc-dup-1')),
      new AbortController().signal,
    );
    const second = await processor.process(
      processorInput(2, projectA, 'pg-proc-dup-1', errorEnvelope('pg-proc-dup-1')),
      new AbortController().signal,
    );
    expect(first).toEqual({ outcome: 'processed' });
    expect(second).toEqual({ outcome: 'processed' });
    const rows = await queryRows<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'pg-proc-dup-1'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects a non-error envelope as a local precondition without persisting', async () => {
    const processor = createErrorEventProcessor({
      persist: (input) => persistErrorEventOccurrence(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    });
    const result = await processor.process(
      processorInput(3, projectA, 'pg-proc-request-1', requestEnvelope('pg-proc-request-1')),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    const rows = await queryRows<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'pg-proc-request-1'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('maps a store temporary failure to retry with a bounded availableAt', async () => {
    const processor = createErrorEventProcessor({
      persist: () => Promise.resolve({ status: 'temporarily_unavailable' }),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const result = await processor.process(
      processorInput(4, projectA, 'pg-proc-temp-1', errorEnvelope('pg-proc-temp-1')),
      new AbortController().signal,
    );
    expect(result.outcome).toBe('retry');
    if (result.outcome === 'retry') {
      expect(result.errorCode).toBe('service_temporarily_unavailable');
      expect(result.availableAt.getTime()).toBe(new Date('2026-08-03T00:00:00.050Z').getTime());
    }
  });

  it('produces at most one occurrence across concurrent duplicate calls', async () => {
    const processor = createErrorEventProcessor({
      persist: (input) => persistErrorEventOccurrence(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    });
    const input = processorInput(5, projectB, 'pg-proc-conc-1', errorEnvelope('pg-proc-conc-1'));
    const results = await Promise.all([
      processor.process(input, new AbortController().signal),
      processor.process(input, new AbortController().signal),
    ]);
    for (const result of results) {
      expect(result.outcome).toBe('processed');
    }
    const rows = await queryRows<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'pg-proc-conc-1' AND project_id = '${projectB}'`,
    );
    expect(rows).toHaveLength(1);
  });
});
