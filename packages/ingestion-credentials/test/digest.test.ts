import { describe, expect, it } from 'vitest';
import {
  DUMMY_DIGEST,
  sha256Digest,
  timingSafeDigestEqual,
} from '../src/digest.js';

describe('sha256Digest', () => {
  it('returns a fixed 32-byte digest', () => {
    const digest = sha256Digest(new Uint8Array(32));
    expect(digest.length).toBe(32);
  });

  it('produces the same digest for the same secret', () => {
    const secret = new Uint8Array(32).fill(7);
    expect(sha256Digest(secret).equals(sha256Digest(secret))).toBe(true);
  });

  it('produces different digests for different secrets', () => {
    const a = new Uint8Array(32).fill(1);
    const b = new Uint8Array(32).fill(2);
    expect(sha256Digest(a).equals(sha256Digest(b))).toBe(false);
  });
});

describe('timingSafeDigestEqual', () => {
  it('returns true for equal digests', () => {
    const a = sha256Digest(new Uint8Array(32).fill(3));
    const b = sha256Digest(new Uint8Array(32).fill(3));
    expect(timingSafeDigestEqual(a, b)).toBe(true);
  });

  it('returns false for unequal digests', () => {
    const a = sha256Digest(new Uint8Array(32).fill(3));
    const b = sha256Digest(new Uint8Array(32).fill(4));
    expect(timingSafeDigestEqual(a, b)).toBe(false);
  });

  it('returns false without throwing for different lengths', () => {
    expect(timingSafeDigestEqual(new Uint8Array(16), new Uint8Array(32))).toBe(false);
    expect(timingSafeDigestEqual(new Uint8Array(32), new Uint8Array(16))).toBe(false);
  });
});

describe('DUMMY_DIGEST', () => {
  it('is a fixed 32-byte buffer', () => {
    expect(DUMMY_DIGEST.length).toBe(32);
  });
});
