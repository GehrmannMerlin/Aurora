import type { Pool, PoolClient } from 'pg';
import { PlatformIdentityError, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

/** The two authoritative intent tables share an identical schema. */
export type IntentKind = 'email_verification' | 'password_reset';

/** camelCase projection of an intent row. */
export interface IntentRow {
  readonly intentId: string;
  readonly accountId: string;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export interface InsertIntentInput {
  readonly accountId: string;
  readonly tokenDigest: string;
  readonly expiresAt: Date;
}

export interface InsertIntentResult {
  readonly status: 'success';
  readonly intentId: string;
}

export interface ConsumeIntentInput {
  readonly kind: IntentKind;
  readonly intentId: string;
  readonly now: Date;
}

export type ConsumeIntentResult =
  | { readonly status: 'success' }
  | { readonly status: 'already_consumed' }
  | { readonly status: 'expired' }
  | { readonly status: 'not_found' };

/** Whitelisted table selector; never interpolate caller input into SQL. */
const INTENT_TABLES: Readonly<Record<IntentKind, string>> = {
  email_verification: 'email_verification_intents',
  password_reset: 'password_reset_intents',
};

function intentTable(kind: IntentKind): string {
  // INTENT_TABLES is a complete Record over IntentKind, so lookup always succeeds.
  return INTENT_TABLES[kind];
}

interface IntentRowShape {
  intent_id: string;
  account_id: string;
  token_digest: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

function toIntentRow(row: IntentRowShape): IntentRow {
  return {
    intentId: row.intent_id,
    accountId: row.account_id,
    tokenDigest: row.token_digest,
    expiresAt: isoTimestamp(row.expires_at),
    consumedAt: isoTimestamp(row.consumed_at),
    createdAt: isoTimestamp(row.created_at),
  };
}

const INSERT_SQL = `
  INSERT INTO %s (account_id, token_digest, expires_at)
  VALUES ($1, $2, $3)
  RETURNING intent_id
`;

async function insertIntent(
  pool: Pool | PoolClient,
  kind: IntentKind,
  input: InsertIntentInput,
): Promise<InsertIntentResult> {
  try {
    const result = await pool.query<{ intent_id: string }>(
      INSERT_SQL.replace('%s', intentTable(kind)),
      [input.accountId, input.tokenDigest, input.expiresAt.toISOString()],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PlatformIdentityError('statement_failed', 'intent insert returned no row');
    }
    return { status: 'success', intentId: row.intent_id };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Insert an email verification intent; only the token digest is stored. */
export async function insertEmailVerificationIntent(
  pool: Pool | PoolClient,
  input: InsertIntentInput,
): Promise<InsertIntentResult> {
  return insertIntent(pool, 'email_verification', input);
}

/** Insert a password reset intent; only the token digest is stored. */
export async function insertPasswordResetIntent(
  pool: Pool | PoolClient,
  input: InsertIntentInput,
): Promise<InsertIntentResult> {
  return insertIntent(pool, 'password_reset', input);
}

/** Consume every still-unused email verification intent for one account. */
export async function supersedeEmailVerificationIntents(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly now: Date },
): Promise<void> {
  try {
    await pool.query(
      `UPDATE email_verification_intents
       SET consumed_at = $2
       WHERE account_id = $1 AND consumed_at IS NULL`,
      [input.accountId, input.now.toISOString()],
    );
  } catch (error) {
    throw toStableError(error);
  }
}

const SELECT_BY_DIGEST_SQL = `
  SELECT intent_id, account_id, token_digest, expires_at, consumed_at, created_at
  FROM %s
  WHERE token_digest = $1
`;

async function findIntentByDigest(
  pool: Pool | PoolClient,
  kind: IntentKind,
  digest: string,
): Promise<IntentRow | null> {
  try {
    const result = await pool.query<IntentRowShape>(
      SELECT_BY_DIGEST_SQL.replace('%s', intentTable(kind)),
      [digest],
    );
    const row = result.rows[0];
    return row === undefined ? null : toIntentRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Find an email verification intent by its token digest. */
export async function findEmailVerificationIntentByDigest(
  pool: Pool | PoolClient,
  digest: string,
): Promise<IntentRow | null> {
  return findIntentByDigest(pool, 'email_verification', digest);
}

/** Find a password reset intent by its token digest. */
export async function findPasswordResetIntentByDigest(
  pool: Pool | PoolClient,
  digest: string,
): Promise<IntentRow | null> {
  return findIntentByDigest(pool, 'password_reset', digest);
}

const CONSUME_SQL = `
  UPDATE %s
  SET consumed_at = $2
  WHERE intent_id = $1 AND consumed_at IS NULL AND expires_at > $2
  RETURNING intent_id
`;

const CLASSIFY_SQL = `
  SELECT consumed_at, expires_at FROM %s WHERE intent_id = $1
`;

/**
 * Atomically consume a one-time intent. Only the caller whose UPDATE first
 * matches `consumed_at IS NULL AND expires_at > now()` succeeds; a follow-up
 * read classifies why an attempt did not consume (expired vs already consumed
 * vs missing). The consume itself is a single atomic UPDATE.
 */
export async function consumeIntent(
  pool: Pool | PoolClient,
  input: ConsumeIntentInput,
): Promise<ConsumeIntentResult> {
  try {
    const table = intentTable(input.kind);
    const consumed = await pool.query(CONSUME_SQL.replace('%s', table), [
      input.intentId,
      input.now.toISOString(),
    ]);
    if (consumed.rows.length > 0) return { status: 'success' };
    const row = await pool.query<{ consumed_at: string | null; expires_at: string }>(
      CLASSIFY_SQL.replace('%s', table),
      [input.intentId],
    );
    const existing = row.rows[0];
    if (existing === undefined) return { status: 'not_found' };
    if (existing.consumed_at !== null) return { status: 'already_consumed' };
    return { status: 'expired' };
  } catch (error) {
    throw toStableError(error);
  }
}
