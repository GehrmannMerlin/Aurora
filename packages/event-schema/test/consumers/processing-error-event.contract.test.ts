import { describe, expect, it } from 'vitest';
import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { boundaryErrorEventSamples } from '@aurora/event-schema/contract-testkit';

describe('processing error-event consumer contract', () => {
  it('agrees with every shared boundary and sanitized output', () => {
    for (const sample of boundaryErrorEventSamples) {
      const result = parseErrorEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (sample.isValid) {
        expect(result, sample.name).toEqual({ success: true, data: sample.expected });
      } else if (!result.success) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
