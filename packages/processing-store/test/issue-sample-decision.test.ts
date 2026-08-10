import { describe, expect, it } from 'vitest';
import { decideIssueSample } from '../src/index.js';

describe('decideIssueSample', () => {
  it('stores below the cap regardless of kind', () => {
    expect(decideIssueSample({ sampleCount: 0, eventSampleKind: 'regular', evictableSampleId: null }))
      .toEqual({ action: 'store' });
    expect(decideIssueSample({ sampleCount: 99, eventSampleKind: 'regular', evictableSampleId: null }))
      .toEqual({ action: 'store' });
  });

  it('skips regular repeats at capacity', () => {
    expect(decideIssueSample({ sampleCount: 100, eventSampleKind: 'regular', evictableSampleId: 's1' }))
      .toEqual({ action: 'skip' });
  });

  it('skips priority kinds at capacity when nothing is evictable', () => {
    expect(decideIssueSample({ sampleCount: 100, eventSampleKind: 'reappeared', evictableSampleId: null }))
      .toEqual({ action: 'skip' });
    expect(decideIssueSample({ sampleCount: 100, eventSampleKind: 'latest', evictableSampleId: null }))
      .toEqual({ action: 'skip' });
  });

  it('replaces the evictable sample for priority kinds at capacity', () => {
    expect(decideIssueSample({ sampleCount: 100, eventSampleKind: 'reappeared', evictableSampleId: 's9' }))
      .toEqual({ action: 'replace', replaceSampleId: 's9' });
    expect(decideIssueSample({ sampleCount: 100, eventSampleKind: 'latest', evictableSampleId: 's9' }))
      .toEqual({ action: 'replace', replaceSampleId: 's9' });
    expect(decideIssueSample({ sampleCount: 100, eventSampleKind: 'first', evictableSampleId: 's9' }))
      .toEqual({ action: 'replace', replaceSampleId: 's9' });
  });

  it('is deterministic and does not mutate input', () => {
    const input = { sampleCount: 100, eventSampleKind: 'latest', evictableSampleId: 's2' } as const;
    expect(decideIssueSample(input)).toEqual(decideIssueSample(input));
  });
});
