import { describe, expect, it } from 'vitest';
import { parseRequestEventEnvelope } from '@aurora/event-schema';
import { validRequestEventSamples } from '@aurora/event-schema/contract-testkit';

describe('SDK request-event producer contract', () => {
  it('produces every shared legal request envelope', () => {
    expect(validRequestEventSamples).toHaveLength(7);
    for (const sample of validRequestEventSamples) {
      expect(parseRequestEventEnvelope(sample.input), sample.name).toEqual({
        success: true,
        data: sample.expected,
      });
    }
  });
});
