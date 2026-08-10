import type { ErrorEventBody } from '@aurora/event-schema';
import {
  ERROR_FINGERPRINT_VERSION,
  type ErrorFingerprintInput,
  type ErrorFingerprintResult,
} from './error-fingerprint-types.js';

/**
 * Deterministic error normalization + fingerprint (DAT-12 spec §4—§10). Pure:
 * no randomness, no clock, no I/O, no logging, no input mutation. The same
 * input always yields the same fingerprint / normalizedTitle. Only high-
 * confidence dynamic values are replaced (spec §5.1); stable values such as
 * HTTP status codes, version numbers, retry counts and short business numbers
 * are preserved (spec §5.2).
 */

/** Ordered high-confidence dynamic-value replacements (spec §5.1). */
const REPLACEMENTS: readonly { readonly pattern: RegExp; readonly placeholder: string }[] = [
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, placeholder: ':uuid' },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: ':email' },
  { pattern: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g, placeholder: ':timestamp' },
  { pattern: /\b1[3-9]\d{9}\b/g, placeholder: ':phone' },
  { pattern: /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, placeholder: ':phone' },
  { pattern: /\b\(\d{2,4}\)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, placeholder: ':phone' },
  { pattern: /\b[0-9a-f]{16,}\b/g, placeholder: ':hash' },
  { pattern: /\b\d{8,}\b/g, placeholder: ':number' },
  { pattern: /\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*[0-9])[A-Za-z0-9]{16,}\b/g, placeholder: ':random' },
];

/** Bounded component lengths (spec §4.3): the total fingerprint stays ≤ 1024. */
const MAX_MESSAGE_COMPONENT = 512;
const MAX_KEYLOCATION_FILE = 256;
const MAX_FINGERPRINT_LENGTH = 1024;
const TRUNCATED_SUFFIX = ':truncated';

/** Replace high-confidence dynamic values in free text with stable placeholders. */
function normalizeText(input: string): string {
  let result = input;
  for (const { pattern, placeholder } of REPLACEMENTS) {
    result = result.replace(pattern, placeholder);
  }
  return result;
}

/** Bound a component and append a deterministic suffix when truncated. */
function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}${TRUNCATED_SUFFIX}`;
}

/** Escape `|`, backslash and control characters so components cannot collide (spec §4.3). */
function escapeComponent(input: string): string {
  const result = input.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  let out = '';
  for (const ch of result) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out;
}

/** Strip query/fragment and scheme+authority from a file URL, then normalize dynamic path segments (spec §6.2). */
function projectFile(file: string): string {
  const noQuery = file.split(/[?#]/, 1)[0] ?? '';
  const noAuthority = noQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  const noLeadingSlash = noAuthority.replace(/^\/+/, '');
  return normalizeText(noLeadingSlash);
}

interface StackFrame {
  readonly fn?: string;
  readonly file: string;
  readonly line: number;
}

const FRAME_WITH_COL = /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/;
const FRAME_NO_COL = /^at\s+(.+?)\s+\((.+):(\d+)\)$/;
const FRAME_BARE_COL = /^at\s+(.+):(\d+):(\d+)$/;
const FRAME_BARE_NO_COL = /^at\s+(.+):(\d+)$/;

function frameWithFn(fn: string | undefined, file: string, line: number): StackFrame {
  return fn === undefined ? { file, line } : { fn, file, line };
}

function parseStackFrame(line: string): StackFrame | undefined {
  const trimmed = line.trim();
  const withCol = FRAME_WITH_COL.exec(trimmed);
  if (withCol !== null) {
    return frameWithFn(withCol[1], withCol[2] ?? '', Number(withCol[3]));
  }
  const noCol = FRAME_NO_COL.exec(trimmed);
  if (noCol !== null) {
    return frameWithFn(noCol[1], noCol[2] ?? '', Number(noCol[3]));
  }
  const bareCol = FRAME_BARE_COL.exec(trimmed);
  if (bareCol !== null) {
    return { file: bareCol[1] ?? '', line: Number(bareCol[2]) };
  }
  const bareNoCol = FRAME_BARE_NO_COL.exec(trimmed);
  if (bareNoCol !== null) {
    return { file: bareNoCol[1] ?? '', line: Number(bareNoCol[2]) };
  }
  return undefined;
}

function isNoiseFrame(frame: StackFrame): boolean {
  const file = frame.file;
  if (file === '' || file === '<anonymous>' || file === 'native') return true;
  const fn = frame.fn ?? '';
  return (
    fn === 'Error' ||
    fn === 'new Error' ||
    fn === 'construct' ||
    fn === 'async' ||
    fn.startsWith('Promise')
  );
}

/** First meaningful (non-native/anonymous/constructor) frame with a real file location (spec §6.2). */
function selectKeyFrame(stack: string): StackFrame | undefined {
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const frame = parseStackFrame(line);
    if (frame !== undefined) frames.push(frame);
  }
  return frames.find((frame) => !isNoiseFrame(frame));
}

function stackOf(body: ErrorEventBody): string | undefined {
  if (body.category === 'javascript') return body.error.stack;
  if (body.category === 'unhandled_rejection' && body.reason.kind === 'error') {
    return body.reason.error.stack;
  }
  return undefined;
}

function computeType(body: ErrorEventBody): string {
  switch (body.category) {
    case 'javascript':
      return body.error.name ?? 'js_error';
    case 'unhandled_rejection':
      if (body.reason.kind === 'error') return body.reason.error.name ?? 'rejection_error';
      return 'rejection_error';
    case 'resource':
      return body.resource.type;
  }
}

/** Deterministic, bounded canonical projection of a non-standard rejection value (spec §7). */
function canonicalizeNonStandard(value: unknown, depth: number): string {
  if (depth > 8) return ':deep';
  if (value === null) return 'null';
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeNonStandard(item, depth + 1)).join(',') + ']';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return (
      '{' +
      keys
        .map((key) => key + ':' + canonicalizeNonStandard(record[key], depth + 1))
        .join(',') +
      '}'
    );
  }
  return ':unknown';
}

function messageComponent(body: ErrorEventBody): string {
  let raw: string;
  switch (body.category) {
    case 'javascript':
      raw = body.error.message;
      break;
    case 'unhandled_rejection':
      if (body.reason.kind === 'error') {
        raw = body.reason.error.message;
      } else if (body.reason.kind === 'string') {
        raw = body.reason.value;
      } else {
        return truncate(canonicalizeNonStandard(body.reason.value, 0), MAX_MESSAGE_COMPONENT);
      }
      break;
    case 'resource':
      // Spec §7: normalized URL path only — authority/scheme/query never enter the fingerprint.
      return truncate(projectFile(body.resource.url), MAX_MESSAGE_COMPONENT);
  }
  const normalized = normalizeText(raw);
  if (normalized === '') return ':empty_message';
  return truncate(normalized, MAX_MESSAGE_COMPONENT);
}

/**
 * Compute the stable, versioned fingerprint/group key and the safe normalized
 * title for a validated error body. The key is the version-prefixed, ordered
 * composition of spec §4.2: `v{version}|{type}|{keyLocation?}|{normalizedMessage}`.
 */
export function computeErrorFingerprint(input: ErrorFingerprintInput): ErrorFingerprintResult {
  const parts: string[] = ['v' + String(ERROR_FINGERPRINT_VERSION), computeType(input.body)];
  const stack = stackOf(input.body);
  if (stack !== undefined) {
    const keyFrame = selectKeyFrame(stack);
    if (keyFrame !== undefined) {
      parts.push(
        truncate(projectFile(keyFrame.file), MAX_KEYLOCATION_FILE) + ':' + String(keyFrame.line),
      );
    }
  }
  const message = messageComponent(input.body);
  parts.push(message);
  const joined = parts.map(escapeComponent).join('|');
  return {
    // Belt-and-suspenders: even if a component slipped past its bound, the total
    // stays ≤ MAX_FINGERPRINT_LENGTH so the store's 1024-char column never overflows.
    fingerprint: truncate(joined, MAX_FINGERPRINT_LENGTH),
    fingerprintVersion: ERROR_FINGERPRINT_VERSION,
    normalizedTitle: message,
  };
}
