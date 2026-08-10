import { describe, expect, it } from 'vitest';
import { negotiateProtocolVersion, parseEventEnvelope } from '../src/index.js';

describe('negotiateProtocolVersion', () => {
  it('accepts the supported protocol version 1', () => {
    const result = negotiateProtocolVersion(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe('supported');
      expect(result.version).toBe(1);
    }
  });

  it('rejects unknown and newer versions explicitly without guessing', () => {
    const inputs: readonly unknown[] = [0, 2, 3, -1, 1.5, '1', null, undefined, {}, [], true];
    for (const input of inputs) {
      const result = negotiateProtocolVersion(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('unsupported_version');
        expect(result.requestedVersion).toBe(input);
      }
    }
  });

  it('is consistent with parseEventEnvelope version rejection', () => {
    expect(negotiateProtocolVersion(2).ok).toBe(false);
    const parsed = parseEventEnvelope({
      protocolVersion: 2,
      eventId: 'e1',
      eventType: 'error',
      occurredAt: 1,
      body: {},
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues.some((i) => i.code === 'unsupported_protocol_version')).toBe(true);
    }
  });

  it('returns frozen new results and never mutates input', () => {
    const supported = negotiateProtocolVersion(1);
    expect(Object.isFrozen(supported)).toBe(true);
    const input: { readonly value: number } = { value: 2 };
    const rejected = negotiateProtocolVersion(input);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.requestedVersion).toBe(input);
    expect(input.value).toBe(2);
  });
});
