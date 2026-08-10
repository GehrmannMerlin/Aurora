import { describe, expect, it } from 'vitest';
import { applySdkPrivacyFilter, type SdkEventDraft } from '../src/index.js';

function draft(body: unknown): SdkEventDraft {
  return { eventType: 'error', body };
}

describe('applySdkPrivacyFilter', () => {
  it('keeps a safe draft and strips query params from URL strings', () => {
    const result = applySdkPrivacyFilter(
      draft({ message: 'boom', url: 'https://example.com/a?token=abc&x=1#frag' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event).toEqual({
        eventType: 'error',
        body: { message: 'boom', url: 'https://example.com/a' },
      });
    }
  });

  it('rejects every forbidden field name at nested depth', () => {
    const forbidden = [
      'authorization',
      'cookie',
      'password',
      'requestBody',
      'response_body',
      'formData',
      'dom',
      'consoleLog',
      'ipAddress',
      'token',
      'access_token',
      'refreshToken',
    ];
    for (const key of forbidden) {
      const result = applySdkPrivacyFilter(draft({ nested: { [key]: 'secret' } }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('forbidden_field');
    }
  });

  it('returns invalid_draft for an invalid draft shape', () => {
    const result = applySdkPrivacyFilter({ eventType: 'nope', body: {} } as unknown as SdkEventDraft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_draft');
  });

  it('returns invalid_draft on cycle or overflowing depth', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    const cycle = applySdkPrivacyFilter(draft(cyclic));
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.code).toBe('invalid_draft');

    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i += 1) deep = { next: deep };
    const overflow = applySdkPrivacyFilter(draft(deep));
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.code).toBe('invalid_draft');
  });

  it('does not mutate the input and returns a new draft', () => {
    const input: SdkEventDraft = {
      eventType: 'error',
      body: { url: 'https://example.com/a?q=1', message: 'x' },
    };
    const result = applySdkPrivacyFilter(input);
    expect(result.ok).toBe(true);
    expect(input.body).toEqual({ url: 'https://example.com/a?q=1', message: 'x' });
    if (result.ok) {
      expect(result.event).not.toBe(input);
      expect(result.event?.body).not.toBe(input.body);
    }
  });

  it('keeps safe scalars and nested primitives intact', () => {
    const result = applySdkPrivacyFilter(
      draft({ count: 3, flag: true, nothing: null, list: ['a', 2], meta: { tag: 'ok' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event?.body).toEqual({ count: 3, flag: true, nothing: null, list: ['a', 2], meta: { tag: 'ok' } });
    }
  });
});
