import { describe, expect, it } from 'vitest';
import { parseEventEnvelope } from '@aurora/event-schema';
import { validEventEnvelopeSamples } from '@aurora/event-schema/contract-testkit';

describe('SDK producer contract', () => {
  it('accepts every shared legal envelope through the public parser', () => {
    expect(validEventEnvelopeSamples).toHaveLength(6);
    for (const sample of validEventEnvelopeSamples) {
      expect(parseEventEnvelope(sample)).toEqual({ success: true, data: sample });
    }
  });
});
