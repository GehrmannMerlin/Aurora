import { describe, expect, it } from 'vitest';
import { parseRequestEventEnvelope } from '@aurora/event-schema';
import { invalidRequestEventSamples } from '@aurora/event-schema/contract-testkit';

describe('ingestion request-event consumer contract', () => {
  it('rejects every shared illegal request envelope with its stable code', () => {
    for (const sample of invalidRequestEventSamples) {
      const result = parseRequestEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (!result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
