import { describe, expect, it } from 'vitest';
import { decodeIssueCursor, encodeIssueCursor } from '../src/index.js';

describe('issue query cursor', () => {
  it('round-trips the keyset cursor', () => {
    const cursor = encodeIssueCursor('2026-08-10T00:00:00.000Z', '42');
    const decoded = decodeIssueCursor(cursor);
    expect(decoded).toEqual({ lastSeenAtIso: '2026-08-10T00:00:00.000Z', issueId: '42' });
  });

  it('rejects malformed cursors', () => {
    expect(decodeIssueCursor('not-base64!!')).toBe(null);
    expect(decodeIssueCursor('')).toBe(null);
    expect(decodeIssueCursor('no-separator')).toBe(null);
  });
});
