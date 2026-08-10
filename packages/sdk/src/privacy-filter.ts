import { EVENT_SCHEMA_LIMITS } from '@aurora/event-schema';
import { isSdkEventDraft, type SdkEventDraft } from './event-draft.js';

export type SdkPrivacyFilterCode = 'ok' | 'forbidden_field' | 'invalid_draft';

export interface SdkPrivacyFilterResult {
  readonly ok: boolean;
  readonly code: SdkPrivacyFilterCode;
  readonly event?: SdkEventDraft;
}

const FORBIDDEN_NORMALIZED: readonly string[] = Object.freeze([
  'authorization',
  'cookie',
  'password',
  'requestbody',
  'responsebody',
  'formdata',
  'dom',
  'consolelog',
  'ipaddress',
  'token',
  'accesstoken',
  'refreshtoken',
]);

function normalizeFieldName(key: string): string {
  return key.replace(/[_\-]/g, '').toLowerCase();
}

function stripUrlSensitiveParts(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  const fragmentIndex = value.indexOf('#');
  const withoutFragment = fragmentIndex >= 0 ? value.slice(0, fragmentIndex) : value;
  const queryIndex = withoutFragment.indexOf('?');
  return queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
}

const MAX_DEPTH = EVENT_SCHEMA_LIMITS.maxObjectDepth;
const MAX_KEYS = EVENT_SCHEMA_LIMITS.maxObjectKeys;
const MAX_ARRAY = EVENT_SCHEMA_LIMITS.maxArrayLength;
const MAX_STRING = EVENT_SCHEMA_LIMITS.maxStringLength;

function sanitizeValue(input: unknown, depth: number, seen: ReadonlySet<object>): unknown | symbol {
  if (depth > MAX_DEPTH) return SANITIZE_OVERFLOW;
  if (typeof input === 'string') {
    if (input.length > MAX_STRING) return SANITIZE_OVERFLOW;
    return stripUrlSensitiveParts(input);
  }
  if (typeof input === 'number' || typeof input === 'boolean' || input === null) return input;
  if (typeof input !== 'object') return SANITIZE_OVERFLOW;
  if (seen.has(input)) return SANITIZE_OVERFLOW;
  const nextSeen = new Set<object>(seen).add(input);
  if (Array.isArray(input)) {
    if (input.length > MAX_ARRAY) return SANITIZE_OVERFLOW;
    const out: unknown[] = [];
    for (const item of input) {
      const sanitized = sanitizeValue(item, depth + 1, nextSeen);
      if (sanitized === SANITIZE_OVERFLOW) return SANITIZE_OVERFLOW;
      out.push(sanitized);
    }
    return out;
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return SANITIZE_OVERFLOW;
  const keys = Object.keys(input);
  if (keys.length > MAX_KEYS) return SANITIZE_OVERFLOW;
  for (const key of keys) {
    if (FORBIDDEN_NORMALIZED.includes(normalizeFieldName(key))) return SANITIZE_FORBIDDEN;
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const sanitized = sanitizeValue((input as Record<string, unknown>)[key], depth + 1, nextSeen);
    if (sanitized === SANITIZE_OVERFLOW) return SANITIZE_OVERFLOW;
    if (sanitized === SANITIZE_FORBIDDEN) return SANITIZE_FORBIDDEN;
    out[key] = sanitized;
  }
  return out;
}

const SANITIZE_OVERFLOW = Symbol('sanitize-overflow');
const SANITIZE_FORBIDDEN = Symbol('sanitize-forbidden');

export function applySdkPrivacyFilter(draft: SdkEventDraft): SdkPrivacyFilterResult {
  if (!isSdkEventDraft(draft)) {
    return Object.freeze({ ok: false, code: 'invalid_draft' });
  }
  const sanitized = sanitizeValue(draft.body, 0, new Set());
  if (sanitized === SANITIZE_FORBIDDEN) {
    return Object.freeze({ ok: false, code: 'forbidden_field' });
  }
  if (sanitized === SANITIZE_OVERFLOW) {
    return Object.freeze({ ok: false, code: 'invalid_draft' });
  }
  return Object.freeze({
    ok: true,
    code: 'ok',
    event: Object.freeze({ eventType: draft.eventType, body: sanitized }),
  });
}
