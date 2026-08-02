import { boundaryPerformanceEventSamples } from '../../src/contract-testkit/index.js';
import { parsePerformanceEventEnvelope } from '../../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('processing performance event consumer contract', () => {
  it('accepts valid boundary samples and rejects invalid ones with the expected code', () => {
    for (const sample of boundaryPerformanceEventSamples) {
      const result = parsePerformanceEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (!result.success && sample.expectedIssueCode !== undefined) {
        expect(
          result.issues.map(({ code }) => code),
          sample.name,
        ).toContain(sample.expectedIssueCode);
      }
    }
  });
});
