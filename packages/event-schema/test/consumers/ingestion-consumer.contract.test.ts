import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '@aurora/event-schema';
import { invalidEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';

describe('ingestion consumer contract', () => {
  it('rejects every shared illegal envelope with its stable issue code', () => {
    for (const sample of invalidEventEnvelopeSamples) {
      const result = parseEventEnvelope(sample.input);
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
