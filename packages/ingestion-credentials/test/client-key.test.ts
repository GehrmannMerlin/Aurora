import { describe, expect, it } from 'vitest';
import {
  KEY_ID_LENGTH,
  parseIngestionClientKey,
  SECRET_LENGTH,
} from '../src/client-key.js';

const VALID_KEY_ID = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22 chars, decodes to 16 bytes
const VALID_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 43 chars, 32 bytes
const VALID_KEY = `aurora_ingest_${VALID_KEY_ID}_${VALID_SECRET}`;

describe('parseIngestionClientKey', () => {
  it('parses a valid key into keyId and secret', () => {
    const parsed = parseIngestionClientKey(VALID_KEY);
    expect(parsed).not.toBeNull();
    expect(parsed?.keyId).toBe(VALID_KEY_ID);
    expect(parsed?.secret).toBe(VALID_SECRET);
  });

  it('rejects a wrong prefix', () => {
    expect(parseIngestionClientKey(`aurora_x_${VALID_KEY_ID}_${VALID_SECRET}`)).toBeNull();
    expect(parseIngestionClientKey(`x${VALID_KEY_ID}_${VALID_SECRET}`)).toBeNull();
  });

  it('rejects missing segments', () => {
    expect(parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}`)).toBeNull();
    expect(parseIngestionClientKey('aurora_ingest')).toBeNull();
  });

  it('rejects an extra segment', () => {
    expect(
      parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${VALID_SECRET}_extra`),
    ).toBeNull();
  });

  it('rejects wrong keyId length', () => {
    const shortKeyId = VALID_KEY_ID.slice(0, 21);
    const longKeyId = `${VALID_KEY_ID}A`;
    expect(parseIngestionClientKey(`aurora_ingest_${shortKeyId}_${VALID_SECRET}`)).toBeNull();
    expect(parseIngestionClientKey(`aurora_ingest_${longKeyId}_${VALID_SECRET}`)).toBeNull();
  });

  it('rejects wrong secret length', () => {
    const shortSecret = VALID_SECRET.slice(0, 42);
    const longSecret = `${VALID_SECRET}A`;
    expect(parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${shortSecret}`)).toBeNull();
    expect(parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${longSecret}`)).toBeNull();
  });

  it('rejects non-base64url characters', () => {
    const badSecret = `${VALID_SECRET.slice(0, 42)}+`;
    expect(parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${badSecret}`)).toBeNull();
    expect(parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${VALID_SECRET}`)).not.toBeNull();
  });

  it('rejects padding', () => {
    const paddedSecret = `${VALID_SECRET.slice(0, 42)}=`;
    expect(parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${paddedSecret}`)).toBeNull();
  });

  it('rejects whitespace', () => {
    expect(
      parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_ ${VALID_SECRET}`),
    ).toBeNull();
  });

  it('does not normalize case (mixed case fails length/byte checks as expected)', () => {
    // Uppercase-only and mixed-case both match the charset regex; decoding must
    // yield exactly 32 bytes for the secret. A mixed-case string of the same
    // length still decodes to 32 bytes, so a different-case key is a distinct
    // secret (no normalization).
    const mixedSecret = `a${VALID_SECRET.slice(1)}`;
    const parsed = parseIngestionClientKey(`aurora_ingest_${VALID_KEY_ID}_${mixedSecret}`);
    expect(parsed?.secret).toBe(mixedSecret);
    expect(parsed?.secret).not.toBe(VALID_SECRET);
  });

  it('exposes the fixed encoded lengths', () => {
    expect(KEY_ID_LENGTH).toBe(22);
    expect(SECRET_LENGTH).toBe(43);
  });

  it('does not modify the input', () => {
    const input = VALID_KEY;
    parseIngestionClientKey(input);
    expect(input).toBe(VALID_KEY);
  });
});
