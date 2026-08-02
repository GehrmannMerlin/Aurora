import { describe, expect, it } from 'vitest';
import { parseErrorEventEnvelope } from '@aurora/event-schema';
import { validErrorEventSamples } from '@aurora/event-schema/contract-testkit';

describe('SDK error-event producer contract', () => {
  it('produces every shared legal error envelope', () => {
    expect(validErrorEventSamples).toHaveLength(6);
    for (const sample of validErrorEventSamples) {
      expect(parseErrorEventEnvelope(sample.input), sample.name).toEqual({
        success: true,
        data: sample.expected,
      });
    }
  });
});
