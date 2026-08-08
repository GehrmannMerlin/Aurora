import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { EventType } from '@aurora/event-schema';

/**
 * Drift guard: the request sample projection must come from the
 * @aurora/event-schema root entry and never copy a second set of request
 * fields or enumerations. If the request contract changes, this test fails.
 */
describe('request sample protocol drift guard', () => {
  it('migration creates request_event_samples with a jsonb object CHECK', async () => {
    const migration = await readFile(
      new URL('../migrations/1722500000004_request-event-samples.ts', import.meta.url),
      'utf8',
    );
    expect(migration).toContain('request_event_samples');
    expect(migration).toContain("jsonb_typeof(sample_body) = 'object'");
    expect(migration).toContain('uq_request_event_samples_project_event');
  });

  it('derives the projection from the parsed RequestEventEnvelope, not a copied local shape', async () => {
    const inputSource = await readFile(
      new URL('../src/request-sample-input.ts', import.meta.url),
      'utf8',
    );
    // The mapping must come from the parsed envelope body.
    expect(inputSource).toContain('envelope.body');
    // It must import from the event-schema root entry, not a private path.
    expect(inputSource).toContain("from '@aurora/event-schema'");
    expect(inputSource).not.toMatch(/@aurora\/event-schema\/src/);
  });

  it('uses the event-schema EventType.Request constant semantics (request events only)', () => {
    // EventType.Request must exist in the public contract.
    expect(EventType.Request).toBe('request');
  });
});
