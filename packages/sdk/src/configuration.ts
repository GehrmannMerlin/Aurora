import { normalizeAllowedOrigin } from './origin.js';

export interface SdkSampleRatesSnapshot {
  readonly errors: number;
  readonly slowRequests: number;
  readonly performance: number;
}

export interface SdkRequestPathRuleSnapshot {
  readonly pattern: string;
  readonly name: string;
}

export interface SdkConfigSnapshot {
  readonly clientKey: string;
  readonly environment: string | null;
  readonly release: string | null;
  readonly sampleRates: SdkSampleRatesSnapshot;
  readonly slowRequestThreshold: number;
  readonly allowedRequestOrigins: readonly string[];
  readonly requestPathRules: readonly SdkRequestPathRuleSnapshot[];
  readonly extraErrorStatusCodes: readonly number[];
  readonly ignoredRequestUrls: readonly string[];
  readonly excludeSameOriginRequests: boolean;
  readonly interactionTrailEnabled: boolean;
  readonly maxActivityTrailEntries: number;
  readonly beforeSend: unknown;
}

export interface SdkConfigFix {
  readonly field: string;
  readonly reason: string;
}

export interface SdkConfigParseFailure {
  readonly ok: false;
  readonly issues: readonly SdkConfigFix[];
}

export interface SdkConfigParseSuccess {
  readonly ok: true;
  readonly config: SdkConfigSnapshot;
  readonly fixes: readonly SdkConfigFix[];
}

export type SdkConfigParseResult = SdkConfigParseFailure | SdkConfigParseSuccess;

const DEFAULT_SAMPLE_RATES: SdkSampleRatesSnapshot = Object.freeze({
  errors: 1,
  slowRequests: 0.2,
  performance: 0.1,
});

export function createSafeDefaultSdkConfig(): SdkConfigSnapshot {
  return Object.freeze({
    clientKey: '',
    environment: null,
    release: null,
    sampleRates: DEFAULT_SAMPLE_RATES,
    slowRequestThreshold: 3000,
    allowedRequestOrigins: Object.freeze([]),
    requestPathRules: Object.freeze([]),
    extraErrorStatusCodes: Object.freeze([]),
    ignoredRequestUrls: Object.freeze([]),
    excludeSameOriginRequests: false,
    interactionTrailEnabled: true,
    maxActivityTrailEntries: 30,
    beforeSend: null,
  });
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readClientKey(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.length === 0 || input.length > 256) return null;
  return input;
}

function readOptionalString(
  input: unknown,
  maxLength: number,
  field: string,
  fixes: SdkConfigFix[],
): string | null {
  if (input === undefined) return null;
  if (typeof input !== 'string' || input.length === 0 || input.length > maxLength) {
    fixes.push({ field, reason: 'must be a non-empty string' });
    return null;
  }
  return input;
}

function readFiniteNumber(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null;
  return input;
}

function readSampleRates(input: unknown, fixes: SdkConfigFix[]): SdkSampleRatesSnapshot {
  if (input === undefined) return DEFAULT_SAMPLE_RATES;
  const source = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) {
    fixes.push({ field: 'sampleRates', reason: 'must be a plain object' });
  }
  const errors = readFiniteNumber(Reflect.get(source, 'errors'));
  const slowRequests = readFiniteNumber(Reflect.get(source, 'slowRequests'));
  const performance = readFiniteNumber(Reflect.get(source, 'performance'));
  const pick = (value: number | null, fallback: number, field: string): number => {
    if (value === null || value < 0 || value > 1) {
      if (value !== null && (value < 0 || value > 1)) {
        fixes.push({ field, reason: 'must be within 0..1' });
      }
      return fallback;
    }
    return value;
  };
  return Object.freeze({
    errors: pick(errors, DEFAULT_SAMPLE_RATES.errors, 'sampleRates.errors'),
    slowRequests: pick(slowRequests, DEFAULT_SAMPLE_RATES.slowRequests, 'sampleRates.slowRequests'),
    performance: pick(performance, DEFAULT_SAMPLE_RATES.performance, 'sampleRates.performance'),
  });
}

function readPositiveInt(input: unknown, fallback: number, field: string, fixes: SdkConfigFix[]): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) {
    if (input !== undefined) fixes.push({ field, reason: 'must be a positive safe integer' });
    return fallback;
  }
  return input;
}

function readRangeInt(
  input: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
  fixes: SdkConfigFix[],
): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
    if (input !== undefined) fixes.push({ field, reason: `must be an integer within ${min}..${max}` });
    return fallback;
  }
  return input;
}

function readOrigins(input: unknown, fixes: SdkConfigFix[]): readonly string[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    fixes.push({ field: 'allowedRequestOrigins', reason: 'must be an array' });
    return Object.freeze([]);
  }
  const result: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string') {
      fixes.push({ field: 'allowedRequestOrigins', reason: 'entry must be a string' });
      continue;
    }
    const normalized = normalizeAllowedOrigin(entry);
    if (normalized === null) {
      fixes.push({ field: 'allowedRequestOrigins', reason: 'entry is not a valid origin or wildcard' });
      continue;
    }
    result.push(normalized);
  }
  return Object.freeze(result);
}

function readPathRules(input: unknown, fixes: SdkConfigFix[]): readonly SdkRequestPathRuleSnapshot[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    fixes.push({ field: 'requestPathRules', reason: 'must be an array' });
    return Object.freeze([]);
  }
  const result: SdkRequestPathRuleSnapshot[] = [];
  for (const entry of input) {
    if (!isPlainObject(entry)) {
      fixes.push({ field: 'requestPathRules', reason: 'entry must be an object' });
      continue;
    }
    const pattern = Reflect.get(entry, 'pattern');
    const name = Reflect.get(entry, 'name');
    if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 512) {
      fixes.push({ field: 'requestPathRules', reason: 'pattern must be a non-empty string' });
      continue;
    }
    if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
      fixes.push({ field: 'requestPathRules', reason: 'name must be a non-empty string' });
      continue;
    }
    result.push(Object.freeze({ pattern, name }));
  }
  return Object.freeze(result);
}

function readStatusCodes(input: unknown, fixes: SdkConfigFix[]): readonly number[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    fixes.push({ field: 'extraErrorStatusCodes', reason: 'must be an array' });
    return Object.freeze([]);
  }
  const result: number[] = [];
  for (const entry of input) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 100 || entry > 599) {
      fixes.push({ field: 'extraErrorStatusCodes', reason: 'entry must be an integer within 100..599' });
      continue;
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

function readStringArray(input: unknown, field: string, fixes: SdkConfigFix[]): readonly string[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    fixes.push({ field, reason: 'must be an array' });
    return Object.freeze([]);
  }
  const result: string[] = [];
  for (const entry of input) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 2048) {
      fixes.push({ field, reason: 'entry must be a non-empty string' });
      continue;
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

function readBoolean(input: unknown, fallback: boolean, field: string, fixes: SdkConfigFix[]): boolean {
  if (typeof input !== 'boolean') {
    if (input !== undefined) fixes.push({ field, reason: 'must be a boolean' });
    return fallback;
  }
  return input;
}

function isValidBeforeSend(input: unknown): boolean {
  if (typeof input === 'function') return true;
  if (Array.isArray(input)) {
    if (input.length === 0) return false;
    return input.every((entry) => typeof entry === 'function');
  }
  return false;
}

export function parseSdkConfig(input: unknown): SdkConfigParseResult {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: Object.freeze([{ field: 'config', reason: 'config must be a plain object' }]),
    };
  }
  const fixes: SdkConfigFix[] = [];
  const clientKey = readClientKey(Reflect.get(input, 'clientKey'));
  if (clientKey === null) {
    return {
      ok: false,
      issues: Object.freeze([
        { field: 'clientKey', reason: 'clientKey must be a non-empty string (max 256 chars)' },
      ]),
    };
  }
  const environment = readOptionalString(Reflect.get(input, 'environment'), 128, 'environment', fixes);
  const release = readOptionalString(Reflect.get(input, 'release'), 128, 'release', fixes);
  const sampleRates = readSampleRates(Reflect.get(input, 'sampleRates'), fixes);
  const slowRequestThreshold = readPositiveInt(
    Reflect.get(input, 'slowRequestThreshold'),
    3000,
    'slowRequestThreshold',
    fixes,
  );
  const allowedRequestOrigins = readOrigins(Reflect.get(input, 'allowedRequestOrigins'), fixes);
  const requestPathRules = readPathRules(Reflect.get(input, 'requestPathRules'), fixes);
  const extraErrorStatusCodes = readStatusCodes(Reflect.get(input, 'extraErrorStatusCodes'), fixes);
  const ignoredRequestUrls = readStringArray(Reflect.get(input, 'ignoredRequestUrls'), 'ignoredRequestUrls', fixes);
  const excludeSameOriginRequests = readBoolean(
    Reflect.get(input, 'excludeSameOriginRequests'),
    false,
    'excludeSameOriginRequests',
    fixes,
  );
  const interactionTrailEnabled = readBoolean(
    Reflect.get(input, 'interactionTrailEnabled'),
    true,
    'interactionTrailEnabled',
    fixes,
  );
  const maxActivityTrailEntries = readRangeInt(
    Reflect.get(input, 'maxActivityTrailEntries'),
    30,
    1,
    1000,
    'maxActivityTrailEntries',
    fixes,
  );
  const beforeSendInput = Reflect.get(input, 'beforeSend');
  let beforeSend: unknown = null;
  if (beforeSendInput !== undefined) {
    if (isValidBeforeSend(beforeSendInput)) {
      beforeSend = beforeSendInput;
    } else {
      fixes.push({ field: 'beforeSend', reason: 'must be a function or a non-empty array of functions' });
    }
  }
  const config: SdkConfigSnapshot = Object.freeze({
    clientKey,
    environment,
    release,
    sampleRates,
    slowRequestThreshold,
    allowedRequestOrigins,
    requestPathRules,
    extraErrorStatusCodes,
    ignoredRequestUrls,
    excludeSameOriginRequests,
    interactionTrailEnabled,
    maxActivityTrailEntries,
    beforeSend,
  });
  return { ok: true, config, fixes: Object.freeze(fixes) };
}
