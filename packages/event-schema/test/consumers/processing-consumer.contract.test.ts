import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '@aurora/event-schema';
import { boundaryEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';

describe('processing consumer contract', () => {
  it('agrees with every shared boundary expectation', () => {
    for (const sample of boundaryEventEnvelopeSamples) {
      const result = parseEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (!sample.isValid && !result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
