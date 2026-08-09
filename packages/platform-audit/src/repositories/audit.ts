import type { Pool, PoolClient } from 'pg';
import { PlatformAuditError, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

/**
 * PLT-04 B7 read-only security-audit repository.
 *
 * Reads the PLT-03 `security_audit_events` table extended by this package's
 * migration (spec §4.6) and projects a REDACTED, paginated timeline for one
 * organization. This package never writes audit rows — `insertAuditEvent` is
 * owned by the platform-identity / platform-organization /
 * platform-project-governance / platform-credentials packages and is only ever
 * invoked by a management command in the same transaction (PRD §13.3). Permission
 * (B7 is visible only to org owner/admin) is enforced at the service layer, not
 * here: this repository reads by `orgId` only.
 */

export type AuditResult = 'succeeded' | 'failed' | 'blocked';

/** The contract `result` enum (auditListSecurityAuditResponse). */
export const AUDIT_RESULT_VALUES: readonly AuditResult[] = [
  'succeeded',
  'failed',
  'blocked',
] as const;

/**
 * Stable default for a row whose `result` is NULL (written before this
 * extension, or by a writer that does not set it). The contract requires a
 * value, so NULL maps to 'succeeded'.
 */
export const AUDIT_RESULT_DEFAULT: AuditResult = 'succeeded';

/** B7 1-year retention: events older than this window are excluded by default. */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** Default page size when the caller does not pass `limit`. */
export const DEFAULT_AUDIT_PAGE_SIZE = 50;

/** Upper bound matching the contract's `limit: num(1, 100)`. */
export const MAX_AUDIT_PAGE_SIZE = 100;

/** Stable masked actor label for events with no recorded actor (system/automated). */
export const AUDIT_MASKED_UNKNOWN_ACTOR = 'system';

/**
 * The redacted B7 summary projection (spec §5.2
 * `auditListSecurityAuditResponse`). Never exposes the full `details` jsonb,
 * an email, a password, a token digest/plaintext, or the raw account id.
 */
export interface AuditEventSummary {
  readonly eventId: string;
  readonly action: string;
  /** ISO-8601 UTC, millisecond precision (contract `utcTimestamp`). */
  readonly occurredAt: string;
  readonly result: AuditResult;
  /** Masked actor identifier: first 8 hex chars of the uuid + ellipsis. */
  readonly actorMasked: string;
  /** Present only when the event carries a `project_id` (incl. tombstones). */
  readonly targetProjectRef?: { readonly projectId: string };
}

/** Mirror of the contract `paginationMeta` (cursor/nextCursor style). */
export interface AuditPagination {
  readonly cursor?: string;
  readonly nextCursor?: string;
  readonly totalCountStatus: 'available' | 'unavailable';
}

export interface ListAuditEventsInput {
  readonly orgId: string;
  /** Opaque base36(occurredAtMicros).uuidHex cursor from a previous page. */
  readonly cursor?: string;
  /** 1-100, default 50. */
  readonly limit?: number;
  /** Inclusive lower bound on `occurred_at` (ISO-8601). Defaults to now - 1 year. */
  readonly from?: string;
  /** Inclusive upper bound on `occurred_at` (ISO-8601). */
  readonly to?: string;
}

export interface ListAuditEventsResult {
  readonly events: readonly AuditEventSummary[];
  readonly pagination: AuditPagination;
}

export interface DecodedAuditCursor {
  /** Epoch microseconds (full timestamptz precision) of the last row. */
  readonly occurredAtMicros: number;
  readonly eventId: string;
}

interface AuditEventRowShape {
  event_id: string;
  action: string;
  occurred_at: Date | string;
  result: string | null;
  actor_account_id: string | null;
  project_id: string | null;
  /** bigint returned by node-postgres as a string. */
  occurred_at_micros: string;
}

const BASE36_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

const AUDIT_CURSOR_PATTERN = /^[0-9a-z]{1,11}\.[0-9a-f]{32}$/;

function toBase36(value: number): string {
  let n = Math.trunc(value);
  if (n < 0) n = 0;
  let out = '';
  do {
    const digit = n % 36;
    out = (BASE36_DIGITS[digit] ?? '') + out;
    n = Math.floor(n / 36);
  } while (n > 0);
  return out;
}

/**
 * Encode an opaque, URL-safe cursor from the last page row's full-precision
 * `occurred_at` (epoch microseconds) and `event_id`. Fits well under the
 * contract's `str(1, 64)` cursor bound.
 */
export function encodeAuditCursor(occurredAtMicros: number, eventId: string): string {
  return `${toBase36(occurredAtMicros)}.${eventId.replace(/-/g, '').toLowerCase()}`;
}

/** Decode an audit cursor back to its microsecond timestamp and event id. */
export function decodeAuditCursor(cursor: string): DecodedAuditCursor {
  const match = AUDIT_CURSOR_PATTERN.exec(cursor);
  if (match === null) {
    throw new PlatformAuditError('invalid_input', 'invalid audit cursor');
  }
  const separator = cursor.indexOf('.');
  const microsPart = cursor.slice(0, separator);
  const idPart = cursor.slice(separator + 1);
  let micros = 0;
  for (const ch of microsPart) {
    micros = micros * 36 + BASE36_DIGITS.indexOf(ch);
  }
  const uuid = `${idPart.slice(0, 8)}-${idPart.slice(8, 12)}-${idPart.slice(12, 16)}-${idPart.slice(
    16,
    20,
  )}-${idPart.slice(20)}`;
  return { occurredAtMicros: micros, eventId: uuid };
}

/**
 * Rebuild an exact microsecond-precision ISO-8601 UTC string from epoch
 * microseconds. Used to hand the decoded cursor timestamp back to Postgres as a
 * timestamptz parameter without losing sub-millisecond precision.
 */
function microsToIso(totalMicrosInput: number): string {
  const totalMicros = Math.trunc(totalMicrosInput);
  const seconds = Math.floor(totalMicros / 1_000_000);
  const microsInSecond = totalMicros - seconds * 1_000_000;
  const date = new Date(seconds * 1000);
  const millis = Math.floor(microsInSecond / 1000);
  const micros = microsInSecond % 1000;
  const fraction = `${String(millis).padStart(3, '0')}${String(micros).padStart(3, '0')}`;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${String(yyyy)}-${mm}-${dd}T${hh}:${mi}:${ss}.${fraction}Z`;
}

/** Map a stored `result` to the closed contract enum, NULL → stable default. */
export function normalizeAuditResult(value: string | null): AuditResult {
  if (value === null) return AUDIT_RESULT_DEFAULT;
  if ((AUDIT_RESULT_VALUES as readonly string[]).includes(value)) {
    return value as AuditResult;
  }
  // The schema CHECK ck_security_audit_events_result guarantees only the three
  // contract values or NULL can be stored; this fallback keeps the projection
  // closed even if a legacy row predates the constraint.
  return AUDIT_RESULT_DEFAULT;
}

/**
 * Derive the masked actor identifier. The DB stores only `actor_account_id`
 * (uuid); the projection is the first 8 hex chars of the uuid followed by the
 * ellipsis — never the full id, never an email. A missing actor gets a stable
 * non-identifying label.
 */
export function maskActor(actorAccountId: string | null): string {
  if (actorAccountId === null) return AUDIT_MASKED_UNKNOWN_ACTOR;
  const compact = actorAccountId.replace(/-/g, '');
  return `${compact.slice(0, 8)}…`;
}

function toAuditEventSummary(row: AuditEventRowShape): AuditEventSummary {
  return {
    eventId: row.event_id,
    action: row.action,
    occurredAt: isoTimestamp(row.occurred_at),
    result: normalizeAuditResult(row.result),
    actorMasked: maskActor(row.actor_account_id),
    ...(row.project_id !== null ? { targetProjectRef: { projectId: row.project_id } } : {}),
  };
}

interface NormalizedAuditListInput {
  readonly orgId: string;
  readonly cursor?: string;
  readonly limit: number;
  readonly from: string;
  readonly to: string | null;
  /** Microsecond-precision ISO timestamp for the cursor predicate, if any. */
  readonly cursorTime: string | null;
  /** event id for the cursor predicate, if any. */
  readonly cursorId: string | null;
}

function parseIsoTimestamp(value: string | undefined, label: string): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new PlatformAuditError('invalid_input', `${label} must be a valid ISO-8601 timestamp`);
  }
  return parsed;
}

function normalizeInput(input: ListAuditEventsInput): NormalizedAuditListInput {
  const orgId = input.orgId.trim();
  if (orgId.length === 0) {
    throw new PlatformAuditError('invalid_input', 'organization id is required');
  }
  const limit = input.limit ?? DEFAULT_AUDIT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_AUDIT_PAGE_SIZE) {
    throw new PlatformAuditError('invalid_input', 'limit must be an integer between 1 and 100');
  }
  // B7 1-year retention: without an explicit `from`, only events newer than
  // now - 365 days are returned.
  const from = parseIsoTimestamp(input.from, 'from') ?? new Date(Date.now() - AUDIT_RETENTION_MS);
  const to = parseIsoTimestamp(input.to, 'to');
  if (to !== null && from.getTime() > to.getTime()) {
    throw new PlatformAuditError('invalid_input', 'from must not be after to');
  }
  let cursorTime: string | null = null;
  let cursorId: string | null = null;
  if (input.cursor !== undefined) {
    const decoded = decodeAuditCursor(input.cursor);
    cursorTime = microsToIso(decoded.occurredAtMicros);
    cursorId = decoded.eventId;
  }
  return {
    orgId,
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    limit,
    from: from.toISOString(),
    to: to === null ? null : to.toISOString(),
    cursorTime,
    cursorId,
  };
}

async function runListAuditEvents(
  pool: Pool | PoolClient,
  input: NormalizedAuditListInput,
): Promise<ListAuditEventsResult> {
  const params: unknown[] = [input.orgId];
  let where = 'organization_id = $1';
  params.push(input.from);
  where += ` AND occurred_at >= $${String(params.length)}`;
  if (input.to !== null) {
    params.push(input.to);
    where += ` AND occurred_at <= $${String(params.length)}`;
  }
  if (input.cursorTime !== null && input.cursorId !== null) {
    params.push(input.cursorTime, input.cursorId);
    where += ` AND (occurred_at, event_id) < ($${String(params.length - 1)}::timestamptz, $${String(params.length)}::uuid)`;
  }
  params.push(input.limit + 1);
  const result = await pool.query<AuditEventRowShape>(
    `SELECT
       event_id,
       action,
       occurred_at,
       result,
       actor_account_id,
       project_id,
       (floor(EXTRACT(EPOCH FROM occurred_at) * 1000000))::bigint AS occurred_at_micros
     FROM security_audit_events
     WHERE ${where}
     ORDER BY occurred_at DESC, event_id DESC
     LIMIT $${String(params.length)}`,
    params,
  );
  const rows = result.rows;
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const events = pageRows.map(toAuditEventSummary);

  let nextCursor: string | undefined;
  if (hasMore) {
    const last = pageRows[pageRows.length - 1];
    if (last !== undefined) {
      nextCursor = encodeAuditCursor(Number(last.occurred_at_micros), last.event_id);
    }
  }
  const pagination: AuditPagination = {
    totalCountStatus: 'unavailable',
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(nextCursor !== undefined ? { nextCursor } : {}),
  };
  return { events, pagination };
}

/**
 * List an organization's security-audit events as redacted summaries, newest
 * first, with cursor-based pagination and the B7 1-year retention window. This
 * is READ-ONLY: no audit row is ever written by this package.
 */
export async function listAuditEvents(
  pool: Pool | PoolClient,
  input: ListAuditEventsInput,
): Promise<ListAuditEventsResult> {
  const normalized = normalizeInput(input);
  try {
    return await runListAuditEvents(pool, normalized);
  } catch (error) {
    throw toStableError(error);
  }
}
