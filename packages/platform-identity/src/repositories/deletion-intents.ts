import type { Pool, PoolClient } from 'pg';
import { PlatformIdentityError, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

/** One-time mailbox confirmation intent kinds for A5 dual-factor re-check. */
export type DeletionIntentKind = 'deletion_request' | 'deletion_cancel';

/** camelCase projection of an account_deletion_intents row. */
export interface DeletionIntentRow {
  readonly intentId: string;
  readonly accountId: string;
  readonly intentKind: DeletionIntentKind;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface InsertDeletionIntentInput {
  readonly accountId: string;
  readonly intentKind: DeletionIntentKind;
  readonly tokenDigest: string;
  readonly expiresAt: Date;
}

export interface InsertDeletionIntentResult {
  readonly status: 'success';
  readonly intentId: string;
}

export interface ConsumeDeletionIntentInput {
  readonly intentId: string;
  readonly now: Date;
}

export type ConsumeDeletionIntentResult =
  | { readonly status: 'success' }
  | { readonly status: 'already_consumed' }
  | { readonly status: 'expired' }
  | { readonly status: 'not_found' };

interface DeletionIntentRowShape {
  intent_id: string;
  account_id: string;
  intent_kind: DeletionIntentKind;
  token_digest: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

function toDeletionIntentRow(row: DeletionIntentRowShape): DeletionIntentRow {
  return {
    intentId: row.intent_id,
    accountId: row.account_id,
    intentKind: row.intent_kind,
    tokenDigest: row.token_digest,
    expiresAt: isoTimestamp(row.expires_at),
    consumedAt: isoTimestamp(row.consumed_at),
    createdAt: isoTimestamp(row.created_at),
  };
}

/**
 * Insert a deletion intent (request or cancel). Only the SHA-256 token digest
 * is stored; the raw token lives only in the outbox email payload.
 */
export async function insertDeletionIntent(
  pool: Pool | PoolClient,
  input: InsertDeletionIntentInput,
): Promise<InsertDeletionIntentResult> {
  try {
    const result = await pool.query<{ intent_id: string }>(
      `INSERT INTO account_deletion_intents (account_id, intent_kind, token_digest, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING intent_id`,
      [input.accountId, input.intentKind, input.tokenDigest, input.expiresAt.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PlatformIdentityError('statement_failed', 'deletion intent insert returned no row');
    }
    return { status: 'success', intentId: row.intent_id };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Find a deletion intent by its kind and token digest. */
export async function findDeletionIntentByDigest(
  pool: Pool | PoolClient,
  kind: DeletionIntentKind,
  digest: string,
): Promise<DeletionIntentRow | null> {
  try {
    const result = await pool.query<DeletionIntentRowShape>(
      `SELECT intent_id, account_id, intent_kind, token_digest, expires_at, consumed_at, created_at
       FROM account_deletion_intents
       WHERE intent_kind = $1 AND token_digest = $2`,
      [kind, digest],
    );
    const row = result.rows[0];
    return row === undefined ? null : toDeletionIntentRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

const CONSUME_SQL = `
  UPDATE account_deletion_intents
  SET consumed_at = $2
  WHERE intent_id = $1 AND consumed_at IS NULL AND expires_at > $2
  RETURNING intent_id
`;

const CLASSIFY_SQL = `
  SELECT consumed_at, expires_at FROM account_deletion_intents WHERE intent_id = $1
`;

/**
 * Atomically consume a one-time deletion intent. Only the caller whose UPDATE
 * first matches `consumed_at IS NULL AND expires_at > now()` succeeds; a
 * follow-up read classifies why an attempt did not consume (expired vs already
 * consumed vs missing). Mirrors `consumeIntent` in intents.ts.
 */
export async function consumeDeletionIntent(
  pool: Pool | PoolClient,
  input: ConsumeDeletionIntentInput,
): Promise<ConsumeDeletionIntentResult> {
  try {
    const consumed = await pool.query(CONSUME_SQL, [input.intentId, input.now.toISOString()]);
    if (consumed.rows.length > 0) return { status: 'success' };
    const row = await pool.query<{ consumed_at: string | null; expires_at: string }>(CLASSIFY_SQL, [
      input.intentId,
    ]);
    const existing = row.rows[0];
    if (existing === undefined) return { status: 'not_found' };
    if (existing.consumed_at !== null) return { status: 'already_consumed' };
    return { status: 'expired' };
  } catch (error) {
    throw toStableError(error);
  }
}
