export type SafeActivityEntryKind =
  | 'page_enter'
  | 'route_change'
  | 'request_summary'
  | 'resource_error'
  | 'sdk_report'
  | 'prior_error';

export interface SafeActivityEntryBase {
  readonly occurredAt: number;
  readonly sequence: number;
}

export interface SafePageEnterEntry extends SafeActivityEntryBase {
  readonly kind: 'page_enter';
  readonly origin: string;
  readonly pathname: string;
}

export interface SafeRouteChangeEntry extends SafeActivityEntryBase {
  readonly kind: 'route_change';
  readonly pathname: string;
}

export interface SafeRequestSummaryEntry extends SafeActivityEntryBase {
  readonly kind: 'request_summary';
  readonly method: string;
  readonly normalizedUrl: string;
  readonly outcome: string;
  readonly statusCode?: number;
  readonly durationMs: number;
}

export interface SafeResourceErrorEntry extends SafeActivityEntryBase {
  readonly kind: 'resource_error';
  readonly normalizedUrl: string;
}

export interface SafeSdkReportEntry extends SafeActivityEntryBase {
  readonly kind: 'sdk_report';
  readonly action: string;
}

export interface SafePriorErrorEntry extends SafeActivityEntryBase {
  readonly kind: 'prior_error';
  readonly errorClass: string;
  readonly normalizedUrl?: string;
}

export type SafeActivityEntry =
  | SafePageEnterEntry
  | SafeRouteChangeEntry
  | SafeRequestSummaryEntry
  | SafeResourceErrorEntry
  | SafeSdkReportEntry
  | SafePriorErrorEntry;

export type SdkRecordActivityCode = 'recorded' | 'invalid_entry' | 'disabled' | 'destroyed';

export interface SdkRecordActivityResult {
  readonly ok: boolean;
  readonly code: SdkRecordActivityCode;
  readonly sequence: number;
  readonly droppedOldest: number;
}

export interface SdkActivityTrail {
  readonly capacity: number;
  readonly entries: readonly SafeActivityEntry[];
  readonly record: (entry: unknown) => SdkRecordActivityResult;
  readonly destroy: () => void;
}

export interface SdkActivityTrailOptions {
  readonly capacity?: number;
  readonly enabled?: boolean;
}

const KINDS: readonly string[] = Object.freeze([
  'page_enter',
  'route_change',
  'request_summary',
  'resource_error',
  'sdk_report',
  'prior_error',
]);

function hasOnlyAllowedKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function isPositiveSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isBoundedString(value: unknown, maxLength: number, minLength = 0): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength;
}

function isOptionalBoundedString(value: unknown, maxLength: number): boolean {
  return value === undefined || isBoundedString(value, maxLength, 1);
}

function normalizeEntry(input: unknown, sequence: number): SafeActivityEntry | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record: Record<string, unknown> = input as Record<string, unknown>;
  const kind = Reflect.get(record, 'kind');
  const occurredAt = Reflect.get(record, 'occurredAt');
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (!isPositiveSafeInt(occurredAt)) return null;
  const base = { occurredAt, sequence };
  switch (kind) {
    case 'page_enter': {
      if (!hasOnlyAllowedKeys(record, ['kind', 'occurredAt', 'origin', 'pathname'])) return null;
      const origin = Reflect.get(record, 'origin');
      const pathname = Reflect.get(record, 'pathname');
      if (!isBoundedString(origin, 512, 1)) return null;
      if (!isBoundedString(pathname, 2048)) return null;
      return Object.freeze({ kind, ...base, origin, pathname });
    }
    case 'route_change': {
      if (!hasOnlyAllowedKeys(record, ['kind', 'occurredAt', 'pathname'])) return null;
      const pathname = Reflect.get(record, 'pathname');
      if (!isBoundedString(pathname, 2048)) return null;
      return Object.freeze({ kind, ...base, pathname });
    }
    case 'request_summary': {
      if (!hasOnlyAllowedKeys(record, ['kind', 'occurredAt', 'method', 'normalizedUrl', 'outcome', 'statusCode', 'durationMs'])) {
        return null;
      }
      const method = Reflect.get(record, 'method');
      const normalizedUrl = Reflect.get(record, 'normalizedUrl');
      const outcome = Reflect.get(record, 'outcome');
      const statusCode = Reflect.get(record, 'statusCode');
      const durationMs = Reflect.get(record, 'durationMs');
      if (!isBoundedString(method, 32, 1)) return null;
      if (!isBoundedString(normalizedUrl, 2048, 1)) return null;
      if (!isBoundedString(outcome, 32, 1)) return null;
      if (!isOptionalStatusCode(statusCode)) return null;
      if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
      const entry: SafeRequestSummaryEntry =
        statusCode === undefined
          ? Object.freeze({ kind, ...base, method, normalizedUrl, outcome, durationMs })
          : Object.freeze({ kind, ...base, method, normalizedUrl, outcome, statusCode, durationMs });
      return entry;
    }
    case 'resource_error': {
      if (!hasOnlyAllowedKeys(record, ['kind', 'occurredAt', 'normalizedUrl'])) return null;
      const normalizedUrl = Reflect.get(record, 'normalizedUrl');
      if (!isBoundedString(normalizedUrl, 2048, 1)) return null;
      return Object.freeze({ kind, ...base, normalizedUrl });
    }
    case 'sdk_report': {
      if (!hasOnlyAllowedKeys(record, ['kind', 'occurredAt', 'action'])) return null;
      const action = Reflect.get(record, 'action');
      if (!isBoundedString(action, 64, 1)) return null;
      return Object.freeze({ kind, ...base, action });
    }
    case 'prior_error': {
      if (!hasOnlyAllowedKeys(record, ['kind', 'occurredAt', 'errorClass', 'normalizedUrl'])) return null;
      const errorClass = Reflect.get(record, 'errorClass');
      const normalizedUrl = Reflect.get(record, 'normalizedUrl');
      if (!isBoundedString(errorClass, 128, 1)) return null;
      if (!isOptionalBoundedString(normalizedUrl, 2048)) return null;
      const entry: SafePriorErrorEntry =
        normalizedUrl === undefined
          ? Object.freeze({ kind, ...base, errorClass })
          : Object.freeze({ kind, ...base, errorClass, normalizedUrl });
      return entry;
    }
    default:
      return null;
  }
}

function isOptionalStatusCode(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 100 && value <= 599)
  );
}

function normalizeCapacity(capacity: unknown): number {
  if (typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000) {
    return 30;
  }
  return capacity;
}

export function createSdkActivityTrail(options: SdkActivityTrailOptions = {}): SdkActivityTrail {
  const capacity = normalizeCapacity(options.capacity);
  const enabled = options.enabled !== false;
  let entries: SafeActivityEntry[] = [];
  let sequence = 0;
  let isDestroyed = false;
  return Object.freeze({
    capacity,
    get entries(): readonly SafeActivityEntry[] {
      return Object.freeze([...entries]);
    },
    record: (input: unknown): SdkRecordActivityResult => {
      if (isDestroyed) return Object.freeze({ ok: false, code: 'destroyed', sequence: 0, droppedOldest: 0 });
      if (!enabled) return Object.freeze({ ok: false, code: 'disabled', sequence: 0, droppedOldest: 0 });
      const entry = normalizeEntry(input, sequence + 1);
      if (entry === null) return Object.freeze({ ok: false, code: 'invalid_entry', sequence: 0, droppedOldest: 0 });
      sequence += 1;
      entries.push(entry);
      let droppedOldest = 0;
      if (entries.length > capacity) {
        entries = entries.slice(1);
        droppedOldest = 1;
      }
      return Object.freeze({ ok: true, code: 'recorded', sequence, droppedOldest });
    },
    destroy: (): void => {
      isDestroyed = true;
      entries = [];
      sequence = 0;
    },
  });
}
