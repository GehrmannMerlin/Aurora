import type { Pool, PoolClient } from 'pg';
import { toStableError } from '../errors.js';

/**
 * PLT-10a platform audit repository (ADR-034 / platform-admin-and-platform-audit
 * spec). `platform_audit_events` holds the platform-level audit timeline,
 * separate from the org B7 `security_audit_events` timeline. Written by platform
 * commands in the same transaction as the command itself; readable only by
 * platform admins; 1-year retention.
 *
 * The event body is deliberately narrow: `actor_account_id` (full account id,
 * never masked — this is the admin-facing platform audit), a constrained
 * `action`, a constrained `target` payload (never policy bodies/keys/full
 * directory listings), a `result`, and an optional `request_id` correlation id.
 */

/** Canonical platform audit action set (mirrors the migration CHECK list). */
export const PLATFORM_AUDIT_ACTIONS = [
  'admin_bootstrapped',
  'admin_granted',
  'admin_revoked',
  'policy_set_default',
  'policy_set_organization',
  'policy_reset_organization',
  'policy_set_project_limit',
  'policy_clear_project_limit',
  'audit_read',
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

export interface InsertPlatformAuditEventInput {
  readonly actorAccountId: string;
  readonly action: PlatformAuditAction;
  /** Constrained payload; serialized to JSONB (never policy bodies/keys). */
  readonly target: unknown;
  readonly result: 'succeeded' | 'rejected';
  readonly requestId?: string;
}

export interface PlatformAuditEvent {
  readonly eventId: string;
  readonly actorAccountId: string;
  readonly action: PlatformAuditAction;
  readonly target: unknown;
  readonly result: 'succeeded' | 'rejected';
  /** ISO-8601 UTC (contract `utcTimestamp`). */
  readonly occurredAt: string;
  readonly requestId?: string;
}

export interface QueryPlatformAuditEventsInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface PlatformAuditEventsPage {
  readonly items: readonly PlatformAuditEvent[];
  readonly nextCursor?: string;
}

const PAGE_SIZE = 50;

interface PlatformAuditEventRow {
  event_id: string;
  actor_account_id: string;
  action: string;
  target: unknown;
  result: string;
  occurred_at: Date;
  request_id: string | null;
}

function toPlatformAuditEvent(row: PlatformAuditEventRow): PlatformAuditEvent {
  return {
    eventId: row.event_id,
    actorAccountId: row.actor_account_id,
    action: row.action as PlatformAuditAction,
    target: row.target,
    result: row.result as 'succeeded' | 'rejected',
    occurredAt: row.occurred_at.toISOString(),
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
  };
}

const PLATFORM_AUDIT_EVENT_COLUMNS = `
  event_id, actor_account_id, action, target, result, occurred_at, request_id
`;

/**
 * Insert one platform audit event. Runs inside the CALLER's transaction: the
 * caller supplies a `PoolClient` and owns BEGIN/COMMIT/ROLLBACK — this function
 * performs only the INSERT so the audit write is atomic with the command that
 * produced it. DB failures are wrapped as a stable `PlatformAdminError`.
 */
export async function insertPlatformAuditEvent(
  client: PoolClient,
  input: InsertPlatformAuditEventInput,
): Promise<void> {
  try {
    const target = JSON.stringify(input.target);
    await client.query(
      `INSERT INTO platform_audit_events (actor_account_id, action, target, result, request_id)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [input.actorAccountId, input.action, target, input.result, input.requestId ?? null],
    );
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Query the platform audit timeline (keyset pagination, `occurred_at DESC,
 * event_id DESC`, limit default 50 / cap 50). Returns `nextCursor` only when
 * more than `limit` rows remain. The cursor is the base64url of
 * `{ occurredAt, eventId }` (same pattern as the processing-store notification
 * repository).
 */
export async function queryPlatformAuditEvents(
  pool: Pool | PoolClient,
  input: QueryPlatformAuditEventsInput,
): Promise<PlatformAuditEventsPage> {
  try {
    const limit = Math.min(input.limit ?? PAGE_SIZE, PAGE_SIZE);
    const params: unknown[] = [];
    let cursorClause = '';
    if (input.cursor !== undefined) {
      // A malformed cursor (bad base64url / JSON / shape) surfaces below as a DB
      // statement failure → `statement_failed` → 503 (fail-closed, no leak),
      // consistent with the notification-repository pattern.
      const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as {
        occurredAt: string;
        eventId: string;
      };
      params.push(cursor.occurredAt, cursor.eventId);
      cursorClause = `WHERE (occurred_at, event_id) < ($${String(params.length - 1)}, $${String(
        params.length,
      )}::uuid)`;
    }
    params.push(limit + 1);
    const sql = `SELECT ${PLATFORM_AUDIT_EVENT_COLUMNS}
      FROM platform_audit_events
      ${cursorClause}
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT $${String(params.length)}`;
    const result = await pool.query<PlatformAuditEventRow>(sql, params);
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(toPlatformAuditEvent);
    let nextCursor: string | undefined;
    const last = items.length > 0 ? items[items.length - 1] : undefined;
    if (hasMore && last !== undefined) {
      // Keyset cursor limitation: `occurredAt` is millisecond precision
      // (`Date.toISOString`), so two events sharing a millisecond at different
      // microseconds can be skipped/duplicated at a page boundary (mirrors the
      // notification-repository pattern). The `event_id` tiebreak only handles
      // exact-time ties (same timestamp value).
      nextCursor = Buffer.from(
        JSON.stringify({ occurredAt: last.occurredAt, eventId: last.eventId }),
      ).toString('base64url');
    }
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
  } catch (error) {
    throw toStableError(error);
  }
}
