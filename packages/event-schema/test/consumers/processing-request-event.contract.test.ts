import { describe, expect, it } from 'vitest';
import { parseRequestEventEnvelope } from '@aurora/event-schema';
import { boundaryRequestEventSamples } from '@aurora/event-schema/contract-testkit';

describe('processing request-event consumer contract', () => {
  it('agrees with every shared boundary and sanitized output', () => {
    for (const sample of boundaryRequestEventSamples) {
      const result = parseRequestEventEnvelope(sample.input);
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
