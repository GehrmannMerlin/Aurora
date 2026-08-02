import { validPerformanceEventSamples } from '../../src/contract-testkit/index.js';
import { parsePerformanceEventEnvelope } from '../../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('SDK performance event consumer contract', () => {
  it('parses every valid performance sample as a full envelope', () => {
    for (const sample of validPerformanceEventSamples) {
      const result = parsePerformanceEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(sample.expected);
      }
    }
  });
});
