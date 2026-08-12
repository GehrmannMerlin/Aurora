import type { Pool, PoolClient } from 'pg';
import { PlatformAdminError, toStableError } from '../errors.js';

/**
 * PLT-10a platform admin repository (ADR-034 / platform-admin-and-platform-audit
 * spec). `platform_admins` holds an explicit account-level platform admin
 * capability, fully decoupled from any org/project role. Platform commands
 * re-read this table on every authorization; the capability is never cached.
 */

export interface PlatformAdminSummary {
  readonly accountId: string;
  readonly grantedBy: string;
  /** ISO-8601 UTC (contract `utcTimestamp`). */
  readonly grantedAt: string;
}

export type GrantPlatformAdminResult =
  | { readonly status: 'granted' }
  | { readonly status: 'already_admin' }
  | { readonly status: 'account_not_found' }
  | { readonly status: 'temporarily_unavailable' };

export type RevokePlatformAdminResult =
  | { readonly status: 'revoked' }
  | { readonly status: 'not_admin' }
  | { readonly status: 'last_admin' }
  | { readonly status: 'temporarily_unavailable' };

export interface ListPlatformAdminsResult {
  readonly items: readonly PlatformAdminSummary[];
}

export interface BootstrapPlatformAdminsResult {
  readonly seeded: number;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 100;

/** Validate a required account id; throws a stable invalid_input error. */
function requireAccountId(label: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PlatformAdminError('invalid_input', `${label} is required`);
  }
  return trimmed;
}

/** True when the account currently holds the platform admin capability. */
export async function isPlatformAdmin(
  pool: Pool | PoolClient,
  input: { readonly accountId: string },
): Promise<boolean> {
  try {
    const accountId = requireAccountId('account id', input.accountId);
    const result = await pool.query('SELECT 1 FROM platform_admins WHERE account_id = $1', [
      accountId,
    ]);
    return result.rows.length > 0;
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Grant the platform admin capability to an existing account. Idempotent: a
 * second grant of an existing admin returns `already_admin`. Returns
 * `temporarily_unavailable` on any database failure without leaking details.
 */
export async function grantPlatformAdmin(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly grantedBy: string },
): Promise<GrantPlatformAdminResult> {
  try {
    const accountId = requireAccountId('account id', input.accountId);
    const grantedBy = requireAccountId('granted by', input.grantedBy);

    const account = await pool.query('SELECT 1 FROM accounts WHERE account_id = $1', [accountId]);
    if (account.rows.length === 0) return { status: 'account_not_found' };

    const inserted = await pool.query<{ account_id: string }>(
      `INSERT INTO platform_admins (account_id, granted_by)
       VALUES ($1, $2)
       ON CONFLICT (account_id) DO NOTHING
       RETURNING account_id`,
      [accountId, grantedBy],
    );
    if (inserted.rows.length > 0) return { status: 'granted' };
    return { status: 'already_admin' };
  } catch (error) {
    if (error instanceof PlatformAdminError && error.kind === 'invalid_input') throw error;
    return { status: 'temporarily_unavailable' };
  }
}

/**
 * Revoke the platform admin capability. Never removes the last remaining
 * platform admin: inside a transaction the `FOR UPDATE` select locks every
 * admin row, serializing concurrent revokes so the second transaction
 * re-reads the post-commit state. When the target is the only admin it
 * returns `last_admin` and rolls back (no delete, no audit). An account that
 * does not hold the capability returns `not_admin` (`account_not_found` is
 * merged into `not_admin` per the contract).
 *
 * Accepts a `Pool` (self-managed transaction, standalone use) OR a `PoolClient`
 * (caller-owned transaction: the platform-api handler runs revoke + audit +
 * idempotency record atomically in ONE transaction). When a PoolClient is given,
 * this function performs only the locked re-read + DELETE on the caller's
 * connection WITHOUT self-managed BEGIN/COMMIT/ROLLBACK, so a `last_admin`
 * return leaves the caller's transaction intact for the caller to roll back.
 *
 * `revokedBy` is part of the command interface for the handler-layer audit
 * write (Task 5); this repository revokes by account only.
 */
export async function revokePlatformAdmin(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly revokedBy: string },
): Promise<RevokePlatformAdminResult> {
  const accountId = requireAccountId('account id', input.accountId);
  requireAccountId('revoked by', input.revokedBy);

  // A Pool owns a self-managed connection + transaction; a PoolClient is the
  // caller's already-open transaction connection. Discriminate by `release`
  // (PoolClient has it; Pool does not) — NOT by `connect`, because pg's
  // PoolClient extends Client and therefore ALSO has a connect() method, so a
  // connect-based check would wrongly treat the caller's client as a Pool.
  const ownsTransaction = typeof (pool as PoolClient).release !== 'function';
  let client: PoolClient | undefined;
  try {
    client = ownsTransaction ? await (pool as Pool).connect() : (pool as PoolClient);
    if (ownsTransaction) await client.query('BEGIN');

    // Lock every admin row so concurrent revokes serialize: the second
    // transaction blocks on the FOR UPDATE rows until the first commits, then
    // re-reads the post-commit state and correctly returns last_admin.
    const locked = await client.query<{ account_id: string }>(
      'SELECT account_id FROM platform_admins FOR UPDATE',
    );
    const adminIds = locked.rows.map((row) => row.account_id);
    const count = adminIds.length;

    if (count === 1) {
      const onlyAccountId = adminIds[0];
      if (ownsTransaction) await client.query('ROLLBACK');
      if (onlyAccountId === accountId) return { status: 'last_admin' };
      // The single admin is someone else, so the target is not an admin.
      return { status: 'not_admin' };
    }

    const deleted = await client.query<{ account_id: string }>(
      'DELETE FROM platform_admins WHERE account_id = $1 RETURNING account_id',
      [accountId],
    );
    if (deleted.rows.length === 0) {
      if (ownsTransaction) await client.query('ROLLBACK');
      return { status: 'not_admin' };
    }

    if (ownsTransaction) await client.query('COMMIT');
    return { status: 'revoked' };
  } catch (error) {
    if (ownsTransaction) await client?.query('ROLLBACK').catch(() => undefined);
    return { status: 'temporarily_unavailable' };
  } finally {
    if (ownsTransaction) client?.release();
  }
}

/** List platform admins (deterministic order; newest grant first is not assumed). */
export async function listPlatformAdmins(
  pool: Pool | PoolClient,
  input: { readonly limit?: number },
): Promise<ListPlatformAdminsResult> {
  try {
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw new PlatformAdminError(
        'invalid_input',
        `limit must be an integer between 1 and ${String(MAX_LIST_LIMIT)}`,
      );
    }
    const result = await pool.query<{
      account_id: string;
      granted_by: string;
      granted_at: Date;
    }>(
      `SELECT account_id, granted_by, granted_at
       FROM platform_admins
       ORDER BY granted_at ASC, account_id ASC
       LIMIT $1`,
      [limit],
    );
    return {
      items: result.rows.map((row) => ({
        accountId: row.account_id,
        grantedBy: row.granted_by,
        grantedAt: row.granted_at.toISOString(),
      })),
    };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Current number of platform admins (0 when none; never fabricated). */
export async function countPlatformAdmins(pool: Pool | PoolClient): Promise<number> {
  try {
    const result = await pool.query<{ cnt: string }>(
      'SELECT count(*)::bigint AS cnt FROM platform_admins',
    );
    return Number(result.rows[0]?.cnt ?? 0);
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Controlled bootstrap (ADR-034): seed platform admins from an explicit account
 * list. Only existing accounts that are not already admins are inserted; the
 * seeded count is returned. A single `admin_bootstrapped` platform-audit event
 * is written inline in the same transaction (raw SQL — Task 3 formalizes the
 * audit repository). Atomic: any failure rolls the whole seed back.
 */
export async function bootstrapPlatformAdmins(
  pool: Pool,
  input: { readonly accountIds: readonly string[]; readonly bootstrapBy: string },
): Promise<BootstrapPlatformAdminsResult> {
  const bootstrapBy = requireAccountId('bootstrap by', input.bootstrapBy);
  const accountIds = input.accountIds.map((id) => requireAccountId('account id', id));

  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    let seeded = 0;
    for (const accountId of accountIds) {
      const account = await client.query('SELECT 1 FROM accounts WHERE account_id = $1', [
        accountId,
      ]);
      if (account.rows.length === 0) continue;
      const inserted = await client.query<{ account_id: string }>(
        `INSERT INTO platform_admins (account_id, granted_by)
         VALUES ($1, $2)
         ON CONFLICT (account_id) DO NOTHING
         RETURNING account_id`,
        [accountId, bootstrapBy],
      );
      if (inserted.rows.length > 0) seeded += 1;
    }

    await client.query(
      `INSERT INTO platform_audit_events (actor_account_id, action, target, result)
       VALUES ($1, 'admin_bootstrapped', $2::jsonb, 'succeeded')`,
      [bootstrapBy, '{}'],
    );

    await client.query('COMMIT');
    return { seeded };
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    throw toStableError(error);
  } finally {
    client?.release();
  }
}
