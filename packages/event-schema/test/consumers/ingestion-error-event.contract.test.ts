import { describe, expect, it } from 'vitest';
import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { invalidErrorEventSamples } from '@aurora/event-schema/contract-testkit';

describe('ingestion error-event consumer contract', () => {
  it('rejects every shared illegal error envelope with its stable code', () => {
    for (const sample of invalidErrorEventSamples) {
      const result = parseErrorEventEnvelope(sample.input);
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
