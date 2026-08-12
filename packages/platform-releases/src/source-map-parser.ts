/**
 * Minimal deterministic source-map v3 parser and position resolver (PRD §8.3.4).
 * No external dependency; VLQ decoding + mappings decoding + binary-adjacent
 * segment resolution are implemented from the v3 spec. Pure and injectable.
 */

export interface SourceMapV3 {
  readonly version: 3;
  readonly sources: readonly string[];
  readonly names: readonly string[];
  readonly mappings: string;
}

export type SourceMapParseResult =
  | { readonly ok: true; readonly map: SourceMapV3 }
  | { readonly ok: false; readonly code: 'invalid_json' | 'unsupported_version' | 'missing_mappings' };

const BASE64_LOOKUP: Readonly<Record<string, number>> = Object.freeze(
  (() => {
    const table: Record<string, number> = {};
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < chars.length; i += 1) {
      table[chars[i] ?? ''] = i;
    }
    return table;
  })(),
);

/** Decode one base64 VLQ at `start`; returns the signed value and next offset. */
export function decodeVlqValue(
  mappings: string,
  start: number,
): { readonly value: number; readonly next: number } {
  let result = 0;
  let shift = 0;
  let pos = start;
  for (;;) {
    const digit = BASE64_LOOKUP[mappings[pos] ?? ''];
    if (digit === undefined) {
      throw new Error('invalid source map vlq');
    }
    pos += 1;
    const continuation = (digit & 32) !== 0;
    result += (digit & 31) << shift;
    if (!continuation) break;
    shift += 5;
  }
  const negative = (result & 1) !== 0;
  const magnitude = result >>> 1;
  return { value: negative ? -magnitude : magnitude, next: pos };
}

export interface DecodedSegment {
  readonly generatedColumn: number;
  readonly sourceIndex: number | null;
  readonly originalLine: number | null; // 0-indexed
  readonly originalColumn: number | null;
  readonly nameIndex: number | null;
}

/**
 * Decode a source-map v3 `mappings` string into per-generated-line segment
 * lists. Segment fields are relative (generatedColumn resets per line; the
 * others accumulate across the whole file).
 */
export function decodeMappings(mappings: string): readonly (readonly DecodedSegment[])[] {
  const lines: DecodedSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  for (const rawLine of mappings.split(';')) {
    const segments: DecodedSegment[] = [];
    let generatedColumn = 0;
    if (rawLine.length > 0) {
      for (const rawSegment of rawLine.split(',')) {
        const fields: number[] = [];
        let pos = 0;
        while (pos < rawSegment.length) {
          const decoded = decodeVlqValue(rawSegment, pos);
          fields.push(decoded.value);
          pos = decoded.next;
        }
        generatedColumn += fields[0] ?? 0;
        let segment: DecodedSegment;
        if (fields.length >= 4) {
          sourceIndex += fields[1] ?? 0;
          originalLine += fields[2] ?? 0;
          originalColumn += fields[3] ?? 0;
          segment = {
            generatedColumn,
            sourceIndex,
            originalLine,
            originalColumn,
            nameIndex: null,
          };
          if (fields.length >= 5) {
            nameIndex += fields[4] ?? 0;
            segment = { ...segment, nameIndex };
          }
        } else {
          segment = {
            generatedColumn,
            sourceIndex: null,
            originalLine: null,
            originalColumn: null,
            nameIndex: null,
          };
        }
        segments.push(segment);
      }
    }
    lines.push(segments);
  }
  return lines;
}

export interface ResolvedSourcePosition {
  readonly source: string;
  /** 1-indexed original line. */
  readonly line: number;
  readonly column: number;
  readonly name?: string;
}

/**
 * Resolve a generated (line, column) — both 1-indexed line and 0-indexed
 * column per the Error stack convention — to the original source position.
 * Returns null when the position is out of range or the map has no mapping
 * (PRD §8.3.5 "解析位置不存在").
 */
export function resolveSourcePosition(
  map: SourceMapV3,
  line: number,
  column: number,
): ResolvedSourcePosition | null {
  try {
    const segments = decodeMappings(map.mappings)[line - 1];
    if (segments === undefined) return null;
    let best: DecodedSegment | null = null;
    for (const segment of segments) {
      if (segment.generatedColumn <= column) {
        best = segment;
      } else {
        break;
      }
    }
    if (
      best === null ||
      best.sourceIndex === null ||
      best.originalLine === null ||
      best.originalColumn === null
    ) {
      return null;
    }
    const source = map.sources[best.sourceIndex];
    if (source === undefined) return null;
    return {
      source,
      line: best.originalLine + 1,
      column: best.originalColumn,
      ...(best.nameIndex !== null && best.nameIndex >= 0 && best.nameIndex < map.names.length
        ? { name: map.names[best.nameIndex] }
        : {}),
    };
  } catch {
    // Malformed mappings are treated as no-match (never guessed).
    return null;
  }
}

/** Parse a source-map v3 JSON document into a usable form. */
export function parseSourceMapV3(json: string): SourceMapParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, code: 'invalid_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'invalid_json' };
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 3) return { ok: false, code: 'unsupported_version' };
  if (typeof record.mappings !== 'string' || record.mappings.length === 0) {
    return { ok: false, code: 'missing_mappings' };
  }
  const sources = Array.isArray(record.sources)
    ? record.sources.filter((value): value is string => typeof value === 'string')
    : [];
  const names = Array.isArray(record.names)
    ? record.names.filter((value): value is string => typeof value === 'string')
    : [];
  return { ok: true, map: { version: 3, sources, names, mappings: record.mappings } };
}
