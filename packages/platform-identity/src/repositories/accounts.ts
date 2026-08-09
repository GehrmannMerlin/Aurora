import type { Pool, PoolClient } from 'pg';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  PlatformIdentityError,
  toStableError,
} from '../errors.js';
import { normalizeEmail } from '../intent-token.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

/** Core account row (camelCase projection of the accounts table). */
export interface AccountRow {
  readonly accountId: string;
  readonly email: string;
  readonly emailNormalized: string;
  /** null when the account has no credential row yet (LEFT JOIN). */
  readonly passwordHash: string | null;
  readonly passwordVersion: number | null;
  readonly verifiedAt: string | null;
  readonly securityVersion: number;
  readonly status: string;
  /** Authoritative deletion timeline (SEC-01); null until a deletion is requested. */
  readonly deletionRequestedAt: string | null;
  readonly deletionCoolingEndsAt: string | null;
  readonly deletionTerminatedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAccountInput {
  readonly email: string;
  readonly emailNormalized: string;
  readonly passwordHash: string;
  readonly status: 'active' | 'pending_verification';
}

export type CreateAccountResult =
  { readonly status: 'success'; readonly account: AccountRow } | { readonly status: 'conflict' };

export interface UpsertAccountCredentialInput {
  readonly accountId: string;
  readonly passwordHash: string;
  readonly passwordVersion: number;
}

export type AccountMutationResult =
  { readonly status: 'success' } | { readonly status: 'not_found' };

/** Authoritative account lifecycle statuses (matches the accounts CHECK). */
export type AccountStatus = 'active' | 'pending_verification' | 'deletion_cooling' | 'terminated';

interface AccountRowShape {
  account_id: string;
  email: string;
  email_normalized: string;
  password_hash: string | null;
  password_version: number | null;
  verified_at: string | null;
  security_version: number;
  status: string;
  deletion_requested_at: string | null;
  deletion_cooling_ends_at: string | null;
  deletion_terminated_at: string | null;
  created_at: string;
  updated_at: string;
}

function toAccountRow(row: AccountRowShape): AccountRow {
  return {
    accountId: row.account_id,
    email: row.email,
    emailNormalized: row.email_normalized,
    passwordHash: row.password_hash,
    passwordVersion: row.password_version,
    verifiedAt: isoTimestamp(row.verified_at),
    securityVersion: row.security_version,
    status: row.status,
    deletionRequestedAt: isoTimestamp(row.deletion_requested_at),
    deletionCoolingEndsAt: isoTimestamp(row.deletion_cooling_ends_at),
    deletionTerminatedAt: isoTimestamp(row.deletion_terminated_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

const ACCOUNT_SELECT = `
  SELECT
    a.account_id, a.email, a.email_normalized, a.verified_at, a.security_version,
    a.status, a.deletion_requested_at, a.deletion_cooling_ends_at,
    a.deletion_terminated_at, a.created_at, a.updated_at,
    c.password_hash, c.password_version
  FROM accounts a
  LEFT JOIN account_credentials c ON c.account_id = a.account_id
`;

const INSERT_ACCOUNT_SQL = `
  INSERT INTO accounts (email, email_normalized, verified_at, security_version, status)
  VALUES ($1, $2, NULL, 0, $3)
  RETURNING account_id, created_at, updated_at
`;

const INSERT_CREDENTIAL_SQL = `
  INSERT INTO account_credentials (account_id, password_hash, password_version)
  VALUES ($1, $2, 1)
`;

/** The account + initial credential write, runnable on any client (composable). */
async function runCreateAccount(
  client: PoolClient,
  input: CreateAccountInput,
): Promise<AccountRowShape> {
  const inserted = await client.query<{
    account_id: string;
    created_at: string;
    updated_at: string;
  }>(INSERT_ACCOUNT_SQL, [normalizeEmail(input.email), input.emailNormalized, input.status]);
  const insertedRow = inserted.rows[0];
  if (insertedRow === undefined) {
    throw new PlatformIdentityError('statement_failed', 'account insert returned no row');
  }
  await client.query(INSERT_CREDENTIAL_SQL, [insertedRow.account_id, input.passwordHash]);
  return {
    account_id: insertedRow.account_id,
    email: input.email,
    email_normalized: input.emailNormalized,
    password_hash: input.passwordHash,
    password_version: 1,
    verified_at: null,
    security_version: 0,
    status: input.status,
    deletion_requested_at: null,
    deletion_cooling_ends_at: null,
    deletion_terminated_at: null,
    created_at: insertedRow.created_at,
    updated_at: insertedRow.updated_at,
  } satisfies AccountRowShape;
}

/**
 * Create an account and its initial credential. When given a `Pool` this opens
 * a transaction; when given an already-leased `PoolClient` it runs directly on
 * the caller's transaction (so the platform-api layer can compose it with the
 * personal-workspace / intent / outbox / idempotency writes atomically).
 * Returns `conflict` when the email or normalized email already exists (no
 * partial account row is left behind).
 */
export async function createAccount(
  pool: Pool | PoolClient,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  try {
    const account = isPoolClient(pool)
      ? await runCreateAccount(pool, input)
      : await withTransaction(pool, (client) => runCreateAccount(client, input));
    return { status: 'success', account: toAccountRow(account) };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'conflict' };
    throw toStableError(error);
  }
}

/** Find a single account by the canonical email form; null when absent. */
export async function findAccountByEmailNormalized(
  pool: Pool | PoolClient,
  emailNormalized: string,
): Promise<AccountRow | null> {
  try {
    const result = await pool.query<AccountRowShape>(
      `${ACCOUNT_SELECT} WHERE a.email_normalized = $1`,
      [emailNormalized],
    );
    const row = result.rows[0];
    return row === undefined ? null : toAccountRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Get an account by primary key; null when absent. */
export async function getAccountById(
  pool: Pool | PoolClient,
  accountId: string,
): Promise<AccountRow | null> {
  try {
    const result = await pool.query<AccountRowShape>(`${ACCOUNT_SELECT} WHERE a.account_id = $1`, [
      accountId,
    ]);
    const row = result.rows[0];
    return row === undefined ? null : toAccountRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Get an account by primary key with a row-level `FOR UPDATE` lock, held until
 * the caller's transaction commits/rolls back. SEC-01 uses this inside the
 * cancel and lazy-finalization transactions so a concurrent cancel and a
 * boundary finalization serialize on the accounts row instead of both
 * "succeeding" (spec §4.2 不变量: 边界并发不得同时撤销成功与进入不可逆成功).
 * Must be called on a `PoolClient` inside an explicit transaction.
 *
 * `OF a` limits the lock to the accounts side of the account_credentials LEFT
 * JOIN — PostgreSQL rejects `FOR UPDATE` on the nullable side of an outer join.
 */
export async function getAccountByIdForUpdate(
  client: PoolClient,
  accountId: string,
): Promise<AccountRow | null> {
  try {
    const result = await client.query<AccountRowShape>(
      `${ACCOUNT_SELECT} WHERE a.account_id = $1 FOR UPDATE OF a`,
      [accountId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toAccountRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Mark an account email-verified. */
export async function updateAccountVerifiedAt(
  pool: Pool | PoolClient,
  accountId: string,
  now: Date,
): Promise<AccountMutationResult> {
  try {
    const result = await pool.query(
      `UPDATE accounts SET verified_at = $2, updated_at = $2 WHERE account_id = $1 RETURNING account_id`,
      [accountId, now.toISOString()],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Increment security_version (password change / reset session-revocation). */
export async function incrementSecurityVersion(
  pool: Pool | PoolClient,
  accountId: string,
): Promise<
  | { readonly status: 'success'; readonly securityVersion: number }
  | { readonly status: 'not_found' }
> {
  try {
    const result = await pool.query<{ security_version: number }>(
      `UPDATE accounts SET security_version = security_version + 1, updated_at = now()
       WHERE account_id = $1 RETURNING security_version`,
      [accountId],
    );
    const row = result.rows[0];
    return row === undefined
      ? { status: 'not_found' }
      : { status: 'success', securityVersion: row.security_version };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Set the account status to one of the four authoritative lifecycle states. */
export async function updateAccountStatus(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly status: AccountStatus; readonly now: Date },
): Promise<AccountMutationResult> {
  try {
    const result = await pool.query(
      `UPDATE accounts SET status = $2, updated_at = now() WHERE account_id = $1 RETURNING account_id`,
      [input.accountId, input.status],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Atomically transition an account into the deletion cooling period (A5-003).
 * Sets the authoritative requested/cooling-end timestamps and bumps
 * `security_version` in the same statement so the transition and the
 * session-revocation guard are one atomic unit.
 */
export async function recordDeletionRequest(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly coolingEndsAt: Date; readonly now: Date },
): Promise<AccountMutationResult> {
  try {
    const result = await pool.query(
      `UPDATE accounts
       SET status = 'deletion_cooling',
           deletion_requested_at = $2,
           deletion_cooling_ends_at = $3,
           security_version = security_version + 1,
           updated_at = now()
       WHERE account_id = $1
       RETURNING account_id`,
      [input.accountId, input.now.toISOString(), input.coolingEndsAt.toISOString()],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Transition an account to the terminal `terminated` state and record the
 * irreversible-boundary timestamp. Called inside the lazy-finalization
 * transaction together with the cleanup handoff write.
 */
export async function recordDeletionTermination(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly now: Date },
): Promise<AccountMutationResult> {
  try {
    const result = await pool.query(
      `UPDATE accounts
       SET status = 'terminated',
           deletion_terminated_at = $2,
           updated_at = now()
       WHERE account_id = $1
       RETURNING account_id`,
      [input.accountId, input.now.toISOString()],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Insert or replace an account's password credential. `not_found` when the
 * account does not exist (foreign key violation on account_credentials).
 */
export async function upsertAccountCredential(
  pool: Pool | PoolClient,
  input: UpsertAccountCredentialInput,
): Promise<AccountMutationResult> {
  try {
    const result = await pool.query(
      `INSERT INTO account_credentials (account_id, password_hash, password_version, changed_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (account_id)
       DO UPDATE SET password_hash = EXCLUDED.password_hash,
                     password_version = EXCLUDED.password_version,
                     changed_at = now()
       RETURNING account_id`,
      [input.accountId, input.passwordHash, input.passwordVersion],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    if (isForeignKeyViolation(error)) return { status: 'not_found' };
    throw toStableError(error);
  }
}
