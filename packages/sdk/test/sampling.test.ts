import { describe, expect, it } from 'vitest';
import {
  canonicalDraftKey,
  createSafeDefaultSdkConfig,
  decideEventSample,
  decideSdkSample,
  fnv1a64,
  type SdkConfigSnapshot,
} from '../src/index.js';

const CONFIG: SdkConfigSnapshot = createSafeDefaultSdkConfig();

describe('decideSdkSample', () => {
  it('keeps everything at rate 1 and nothing at rate 0', () => {
    expect(decideSdkSample('any', 1)).toBe(true);
    expect(decideSdkSample('any', 0)).toBe(false);
  });

  it('is deterministic for the same key', () => {
    const results = Array.from({ length: 100 }, () => decideSdkSample('fixed-key', 0.5));
    expect(new Set(results).size).toBe(1);
  });

  it('yields an approximately uniform split at rate 0.5', () => {
    let kept = 0;
    const total = 10_000;
    for (let i = 0; i < total; i += 1) {
      if (decideSdkSample(`key-${i}`, 0.5)) kept += 1;
    }
    expect(kept).toBeGreaterThan(total * 0.4);
    expect(kept).toBeLessThan(total * 0.6);
  });

  it('returns false for an empty key below rate 1', () => {
    expect(decideSdkSample('', 0.5)).toBe(false);
    expect(decideSdkSample('', 1)).toBe(true);
  });
});

describe('fnv1a64', () => {
  it('is deterministic and 64-bit', () => {
    const a = fnv1a64('hello');
    const b = fnv1a64('hello');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0n);
    expect(a).toBeLessThan(2n ** 64n);
    expect(fnv1a64('hello')).not.toBe(fnv1a64('world'));
  });
});

describe('canonicalDraftKey', () => {
  it('is stable regardless of object key order', () => {
    const key1 = canonicalDraftKey({ eventType: 'error', body: { a: 1, b: 2 } });
    const key2 = canonicalDraftKey({ eventType: 'error', body: { b: 2, a: 1 } });
    expect(key1).toBe(key2);
  });

  it('produces the expected stable key for a simple error draft', () => {
    expect(canonicalDraftKey({ eventType: 'error', body: { message: 'x' } })).toBe('error:{"message":"x"}');
  });

  it('falls back to an empty-body key on non-serializable input', () => {
    expect(canonicalDraftKey({ eventType: 'error', body: undefined })).toBe('error:{}');
  });
});

describe('decideEventSample', () => {
  const errorDraft = { eventType: 'error' as const, body: { message: 'x' } };

  it('uses the class-specific sample rate', () => {
    const config: SdkConfigSnapshot = {
      ...CONFIG,
      sampleRates: { errors: 1, slowRequests: 0.2, performance: 0.1 },
    };
    expect(decideEventSample(errorDraft, config, { class: 'error' }).sampled).toBe(true);
    const highHash = (): bigint => 2n ** 64n - 1n;
    const decision = decideEventSample(
      { eventType: 'performance' as const, body: { metric: 'lcp' } },
      config,
      { class: 'performance' },
      highHash,
    );
    expect(decision.rate).toBe(0.1);
    expect(decision.sampled).toBe(false);
  });

  it('honors rateOverride', () => {
    const config: SdkConfigSnapshot = { ...CONFIG, sampleRates: { errors: 0.1, slowRequests: 0.2, performance: 0.1 } };
    expect(decideEventSample(errorDraft, config, { class: 'error', rateOverride: 1 }).sampled).toBe(true);
    expect(decideEventSample(errorDraft, config, { class: 'error', rateOverride: 0 }).sampled).toBe(false);
  });

  it('uses eventKey when provided and falls back to the canonical draft key', () => {
    const config: SdkConfigSnapshot = { ...CONFIG, sampleRates: { errors: 0.5, slowRequests: 0.2, performance: 0.1 } };
    const viaKey = decideEventSample(errorDraft, config, { class: 'error', eventKey: 'stable-event' });
    const viaDraft = decideEventSample(errorDraft, config, { class: 'error' });
    expect(viaKey.sampled).toBe(decideSdkSample('stable-event', 0.5));
    expect(viaDraft.sampled).toBe(decideSdkSample('error:{"message":"x"}', 0.5));
  });
});
