import { invalidPerformanceEventSamples } from '../../src/contract-testkit/index.js';
import { parsePerformanceEventEnvelope } from '../../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('ingestion performance event consumer contract', () => {
  it('rejects every invalid performance sample with a stable issue code', () => {
    for (const sample of invalidPerformanceEventSamples) {
      const result = parsePerformanceEventEnvelope(sample.input);
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
