import type { Pool, PoolClient } from 'pg';
import { PlatformIdentityError, isUniqueViolation, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

/** Lifecycle of a persisted cleanup handoff, consumed by the future SEC-02 worker. */
export type CleanupHandoffStatus =
  | 'pending'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'dead_lettered';

/** camelCase projection of an account_cleanup_handoffs row. */
export interface CleanupHandoffRow {
  readonly handoffId: string;
  readonly accountId: string;
  readonly status: CleanupHandoffStatus;
  /** Frozen required-lifecycle intent (7-day online cleanup / 1-year audit / 35-day backup). */
  readonly requiredLifecycle: unknown;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InsertCleanupHandoffInput {
  readonly accountId: string;
  readonly requiredLifecycle: Readonly<Record<string, unknown>>;
  readonly now: Date;
}

export type InsertCleanupHandoffResult =
  | { readonly status: 'success'; readonly handoffId: string }
  | { readonly status: 'already_exists' };

interface CleanupHandoffRowShape {
  handoff_id: string;
  account_id: string;
  status: CleanupHandoffStatus;
  required_lifecycle: unknown;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

function toCleanupHandoffRow(row: CleanupHandoffRowShape): CleanupHandoffRow {
  return {
    handoffId: row.handoff_id,
    accountId: row.account_id,
    status: row.status,
    requiredLifecycle: row.required_lifecycle,
    attemptCount: row.attempt_count,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

/**
 * Persist the cleanup handoff intent for an account crossing the irreversible
 * boundary. Idempotent per account (UNIQUE account_id): a second insert for the
 * same account returns `already_exists` without erroring.
 */
export async function insertCleanupHandoff(
  pool: Pool | PoolClient,
  input: InsertCleanupHandoffInput,
): Promise<InsertCleanupHandoffResult> {
  try {
    const result = await pool.query<{ handoff_id: string }>(
      `INSERT INTO account_cleanup_handoffs (account_id, required_lifecycle, status, created_at, updated_at)
       VALUES ($1, $2::jsonb, 'pending', $3, $3)
       RETURNING handoff_id`,
      [input.accountId, input.requiredLifecycle, input.now.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PlatformIdentityError('statement_failed', 'cleanup handoff insert returned no row');
    }
    return { status: 'success', handoffId: row.handoff_id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'already_exists' };
    throw toStableError(error);
  }
}

/** Get the cleanup handoff for an account; null when none exists. */
export async function findCleanupHandoffByAccount(
  pool: Pool | PoolClient,
  accountId: string,
): Promise<CleanupHandoffRow | null> {
  try {
    const result = await pool.query<CleanupHandoffRowShape>(
      `SELECT handoff_id, account_id, status, required_lifecycle, attempt_count, created_at, updated_at
       FROM account_cleanup_handoffs
       WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toCleanupHandoffRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}
