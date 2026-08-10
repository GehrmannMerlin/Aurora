import { EVENT_SCHEMA_LIMITS, EventType } from '@aurora/event-schema';
import type { SdkConfigSnapshot } from './configuration.js';
import type { SdkEventDraft } from './event-draft.js';

export type SdkHashInput = (input: string) => bigint;

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

export function fnv1a64(input: string): bigint {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & FNV_MASK;
  }
  return hash;
}

export function decideSdkSample(
  eventKey: string,
  rate: number,
  hash: SdkHashInput = fnv1a64,
): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  if (eventKey.length === 0) return false;
  const normalized = Number(hash(eventKey) >> 11n);
  return normalized / 2 ** 53 < rate;
}

const MAX_DEPTH = EVENT_SCHEMA_LIMITS.maxObjectDepth;
const MAX_KEYS = EVENT_SCHEMA_LIMITS.maxObjectKeys;
const MAX_ARRAY = EVENT_SCHEMA_LIMITS.maxArrayLength;
const MAX_STRING = EVENT_SCHEMA_LIMITS.maxStringLength;

function stableSerialize(input: unknown, depth: number, seen: ReadonlySet<object>): string | null {
  if (depth > MAX_DEPTH) return null;
  if (input === null) return 'null';
  if (typeof input === 'string') return JSON.stringify(input.slice(0, MAX_STRING));
  if (typeof input === 'number' || typeof input === 'boolean') return JSON.stringify(input);
  if (typeof input !== 'object') return null;
  if (seen.has(input)) return null;
  const nextSeen = new Set<object>(seen).add(input);
  if (Array.isArray(input)) {
    if (input.length > MAX_ARRAY) return null;
    const parts: string[] = [];
    for (const item of input) {
      const serialized = stableSerialize(item, depth + 1, nextSeen);
      if (serialized === null) return null;
      parts.push(serialized);
    }
    return `[${parts.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(input).sort();
  if (keys.length > MAX_KEYS) return null;
  const parts: string[] = [];
  for (const key of keys) {
    const serialized = stableSerialize((input as Record<string, unknown>)[key], depth + 1, nextSeen);
    if (serialized === null) return null;
    parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

export function canonicalDraftKey(draft: SdkEventDraft): string {
  const serialized = stableSerialize(draft.body, 0, new Set());
  return `${draft.eventType}:${serialized ?? '{}'}`;
}

export type SdkEventClass = 'error' | 'slow' | 'performance' | 'other';

export interface SdkSamplingContext {
  readonly eventKey?: string;
  readonly class: SdkEventClass;
  readonly rateOverride?: number;
}

export interface SdkSamplingDecision {
  readonly sampled: boolean;
  readonly rate: number;
}

function classRate(config: SdkConfigSnapshot, eventClass: SdkEventClass): number {
  switch (eventClass) {
    case 'error':
      return config.sampleRates.errors;
    case 'slow':
      return config.sampleRates.slowRequests;
    case 'performance':
      return config.sampleRates.performance;
    default:
      return 1;
  }
}

export function decideEventSample(
  event: SdkEventDraft,
  config: SdkConfigSnapshot,
  context: SdkSamplingContext,
  hash: SdkHashInput = fnv1a64,
): SdkSamplingDecision {
  let rate = classRate(config, context.class);
  if (typeof context.rateOverride === 'number' && Number.isFinite(context.rateOverride) && context.rateOverride >= 0 && context.rateOverride <= 1) {
    rate = context.rateOverride;
  }
  const key = context.eventKey !== undefined && context.eventKey.length > 0 ? context.eventKey : canonicalDraftKey(event);
  return Object.freeze({ sampled: decideSdkSample(key, rate, hash), rate });
}

export function eventClassOf(eventType: EventType, requestClass: 'error' | 'slow' | 'normal' | null): SdkEventClass {
  if (eventType === EventType.Error) return 'error';
  if (eventType === EventType.Performance) return 'performance';
  if (eventType === EventType.Request) {
    if (requestClass === 'error') return 'error';
    if (requestClass === 'slow') return 'slow';
    return 'other';
  }
  return 'other';
}
