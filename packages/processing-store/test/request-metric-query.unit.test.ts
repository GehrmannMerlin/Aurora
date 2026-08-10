import { describe, expect, it } from 'vitest';
import { ProcessingStoreError } from '../src/errors.js';
import {
  decodeEndpointCursor,
  encodeEndpointCursor,
  endpointIdOf,
} from '../src/request-metric-query-repository.js';

describe('request metric query helpers', () => {
  it('endpointIdOf is a deterministic 64-char hex id', () => {
    const a = endpointIdOf('GET', 'https://api.example.test/orders');
    const b = endpointIdOf('GET', 'https://api.example.test/orders');
    const c = endpointIdOf('POST', 'https://api.example.test/orders');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('cursor round-trips method+url keyset', () => {
    const cursor = encodeEndpointCursor('GET', 'https://api.example.test/orders');
    const decoded = decodeEndpointCursor(cursor);
    expect(decoded).toEqual({ method: 'GET', url: 'https://api.example.test/orders' });
  });
  it('decodeEndpointCursor rejects malformed input with ProcessingStoreError invalid_input', () => {
    expect(() => decodeEndpointCursor('!!!not-base64url!!!')).toThrow(ProcessingStoreError);
    try {
      decodeEndpointCursor('!!!not-base64url!!!');
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingStoreError);
      expect((error as ProcessingStoreError).kind).toBe('invalid_input');
    }
  });
});
