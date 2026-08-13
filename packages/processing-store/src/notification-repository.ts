import type { Pool, PoolClient } from 'pg';
import { ProcessingStoreError } from './errors.js';
import type {
  NotificationRow,
  NotificationTarget,
  NotificationType,
} from './notification-types.js';

/**
 * PLT-09 in-app notification repository (PRD §11.4 / UX/UI §8.30). Account-level
 * rows; `(account_id, business_key, type)` unique so the same business action
 * yields one notification per member. The target is a constrained Route Target
 * (never an arbitrary URL).
 */

export interface PersistNotificationInput {
  readonly accountId: string;
  readonly type: NotificationType;
  readonly businessKey: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly title: string;
  readonly summary?: string;
  readonly target: NotificationTarget;
}

export type PersistNotificationResult =
  | { readonly status: 'inserted'; readonly notificationId: string }
  | { readonly status: 'existing'; readonly notificationId: string };

export interface NotificationListInput {
  readonly accountId: string;
  readonly readState?: 'all' | 'unread';
  readonly cursor?: string;
  readonly limit?: number;
}

export interface NotificationPage {
  readonly items: readonly NotificationRow[];
  readonly nextCursor?: string;
}

export type MarkNotificationReadResult =
  | { readonly status: 'read'; readonly notificationId: string }
  | { readonly status: 'not_found' };

const PAGE_SIZE = 50;

function toStableError(error: unknown): ProcessingStoreError {
  if (error instanceof ProcessingStoreError) return error;
  const code = (() => {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const value = (error as { code?: unknown }).code;
      return typeof value === 'string' ? value : '';
    }
    return '';
  })();
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new ProcessingStoreError('database_unavailable', 'database is unavailable');
  }
  return new ProcessingStoreError('statement_failed', 'database statement failed');
}

interface NotificationRowShape {
  notification_id: string;
  account_id: string;
  organization_id: string | null;
  project_id: string | null;
  type: string;
  title: string;
  summary: string | null;
  target: unknown;
  read_at: Date | null;
  created_at: Date;
}

function toNotificationRow(row: NotificationRowShape): NotificationRow {
  return {
    notificationId: row.notification_id,
    accountId: row.account_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    type: row.type as NotificationType,
    title: row.title,
    summary: row.summary,
    target: row.target as NotificationTarget,
    readAt: row.read_at === null ? null : row.read_at.toISOString(),
    occurredAt: row.created_at.toISOString(),
  };
}

const NOTIFICATION_COLUMNS = `
  notification_id, account_id, organization_id, project_id, type, title, summary,
  target, read_at, created_at
`;

/** Insert a notification; deduplicates by (account_id, business_key, type). */
export async function persistNotification(
  pool: Pool | PoolClient,
  input: PersistNotificationInput,
): Promise<PersistNotificationResult> {
  try {
    const target = JSON.stringify(input.target);
    const inserted = await pool.query<{ notification_id: string }>(
      `INSERT INTO notifications
         (account_id, organization_id, project_id, type, business_key, title, summary, target)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (account_id, business_key, type) DO NOTHING
       RETURNING notification_id`,
      [
        input.accountId,
        input.organizationId ?? null,
        input.projectId ?? null,
        input.type,
        input.businessKey,
        input.title,
        input.summary ?? null,
        target,
      ],
    );
    const row = inserted.rows[0];
    if (row !== undefined) return { status: 'inserted', notificationId: row.notification_id };
    // Conflict: fetch the existing notification id for the same business action.
    const existing = await pool.query<{ notification_id: string }>(
      `SELECT notification_id FROM notifications
       WHERE account_id = $1 AND business_key = $2 AND type = $3`,
      [input.accountId, input.businessKey, input.type],
    );
    const existingRow = existing.rows[0];
    if (existingRow === undefined) {
      throw new ProcessingStoreError('statement_failed', 'dedupe lookup returned no row');
    }
    return { status: 'existing', notificationId: existingRow.notification_id };
  } catch (error) {
    throw toStableError(error);
  }
}

/** List the current account's notifications (keyset pagination, read-state filter). */
export async function queryNotifications(
  pool: Pool | PoolClient,
  input: NotificationListInput,
): Promise<NotificationPage> {
  try {
    const limit = Math.min(input.limit ?? PAGE_SIZE, PAGE_SIZE);
    const params: unknown[] = [input.accountId];
    const clauses = ['account_id = $1'];
    if (input.readState === 'unread') {
      clauses.push('read_at IS NULL');
    }
    let cursorClause = '';
    if (input.cursor !== undefined) {
      const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as {
        occurredAt: string;
        notificationId: string;
      };
      params.push(cursor.occurredAt, cursor.notificationId);
      cursorClause = `AND (created_at, notification_id) < ($${String(params.length - 1)}, $${String(params.length)}::uuid)`;
    }
    params.push(limit + 1);
    const sql = `SELECT ${NOTIFICATION_COLUMNS}
       FROM notifications
       WHERE ${clauses.join(' AND ')} ${cursorClause}
       ORDER BY created_at DESC, notification_id DESC
       LIMIT $${String(params.length)}`;
    const result = await pool.query<NotificationRowShape>(sql, params);
    const hasMore = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map(toNotificationRow);
    let nextCursor: string | undefined;
    const last = items.length > 0 ? items[items.length - 1] : undefined;
    if (hasMore && last !== undefined) {
      nextCursor = Buffer.from(
        JSON.stringify({ occurredAt: last.occurredAt, notificationId: last.notificationId }),
      ).toString('base64url');
    }
    return { items, ...(nextCursor === undefined ? {} : { nextCursor }) };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Unread count for the current account (0 when none; never fabricated). */
export async function queryUnreadCount(
  pool: Pool | PoolClient,
  input: { readonly accountId: string },
): Promise<number> {
  try {
    const result = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*)::bigint AS cnt FROM notifications
       WHERE account_id = $1 AND read_at IS NULL`,
      [input.accountId],
    );
    return Number(result.rows[0]?.cnt ?? 0);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Mark one notification read (account-scoped, idempotent). */
export async function markNotificationRead(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly notificationId: string },
): Promise<MarkNotificationReadResult> {
  try {
    const updated = await pool.query<{ notification_id: string }>(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE notification_id = $1 AND account_id = $2
       RETURNING notification_id`,
      [input.notificationId, input.accountId],
    );
    const row = updated.rows[0];
    if (row === undefined) return { status: 'not_found' };
    return { status: 'read', notificationId: row.notification_id };
  } catch (error) {
    throw toStableError(error);
  }
}
