import { describe, expect, it } from 'vitest';
import {
  decodeVlqValue,
  parseSourceMapV3,
  resolveSourcePosition,
} from '../src/source-map-parser.js';

/** v3 map: generated app.js, source src/app.ts, name "foo", 2 generated lines. */
const MAP = {
  version: 3 as const,
  sources: ['src/app.ts'],
  names: ['foo'],
  mappings: 'AAAAA;CACA',
};

describe('decodeVlqValue', () => {
  it('decodes the canonical base64 VLQ alphabet', () => {
    expect(decodeVlqValue('A', 0).value).toBe(0);
    expect(decodeVlqValue('C', 0).value).toBe(1); // +1
    expect(decodeVlqValue('D', 0).value).toBe(-1); // -1
    expect(decodeVlqValue('gB', 0).value).toBe(16); // continuation bit (0x20)
  });
});

describe('parseSourceMapV3', () => {
  it('parses a valid v3 document', () => {
    const result = parseSourceMapV3(JSON.stringify(MAP));
    expect(result).toEqual({ ok: true, map: MAP });
  });

  it('rejects invalid JSON', () => {
    expect(parseSourceMapV3('not json')).toEqual({ ok: false, code: 'invalid_json' });
  });

  it('rejects unsupported versions', () => {
    expect(parseSourceMapV3(JSON.stringify({ ...MAP, version: 2 }))).toEqual({
      ok: false,
      code: 'unsupported_version',
    });
  });

  it('rejects missing/empty mappings', () => {
    expect(parseSourceMapV3(JSON.stringify({ ...MAP, mappings: '' }))).toEqual({
      ok: false,
      code: 'missing_mappings',
    });
    expect(parseSourceMapV3(JSON.stringify({ version: 3 }))).toEqual({
      ok: false,
      code: 'missing_mappings',
    });
  });
});

describe('resolveSourcePosition', () => {
  it('resolves a generated position to the original source (1-indexed)', () => {
    const result = resolveSourcePosition(MAP, 1, 0);
    expect(result).toEqual({ source: 'src/app.ts', line: 1, column: 0, name: 'foo' });
    // Line 2 maps to original line 2 (origLine delta +1), generated column 1.
    expect(resolveSourcePosition(MAP, 2, 1)).toEqual({ source: 'src/app.ts', line: 2, column: 0 });
  });

  it('returns null for a column before the first mapping on a line', () => {
    expect(resolveSourcePosition(MAP, 2, 0)).toBeNull();
  });

  it('returns null for an out-of-range line', () => {
    expect(resolveSourcePosition(MAP, 3, 0)).toBeNull();
  });

  it('treats a malformed map as no-match (never guesses)', () => {
    const broken = { version: 3 as const, sources: ['a.ts'], names: [], mappings: '%%%!' };
    expect(resolveSourcePosition(broken, 1, 0)).toBeNull();
  });
});
