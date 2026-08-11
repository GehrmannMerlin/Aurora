/**
 * SEC-02 PostgreSQL cleanup adapter — REAL implementation
 * (account-deletion-and-data-lifecycle §6 data classification).
 *
 * Cleans a single account's direct identity + memberships in one transaction:
 *
 * - delete credentials / email / password / deletion intents;
 * - delete organization & project memberships;
 * - revoke pending invitations for the account email;
 * - anonymize security-audit actor/target references (FK-free, 1-year policy);
 * - turn the accounts row into an anonymous terminal shell (email freed, no
 *   original-email tombstone per §10; status stays `terminated`, no login).
 *
 * Business-fact actor anonymization across processing stores depends on a
 * future identity mapping (deferred) and is NOT faked here.
 */

import type { Pool } from 'pg';
import type { CleanupAdapter, CleanupInput, CleanupResult } from './cleanup-adapters.js';

export class PostgresCleanupAdapter implements CleanupAdapter {
  readonly store = 'postgres' as const;

  constructor(private readonly pool: Pool) {}

  async cleanup(input: CleanupInput): Promise<CleanupResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM account_credentials WHERE account_id = $1', [
        input.accountId,
      ]);
      await client.query('DELETE FROM email_verification_intents WHERE account_id = $1', [
        input.accountId,
      ]);
      await client.query('DELETE FROM password_reset_intents WHERE account_id = $1', [
        input.accountId,
      ]);
      await client.query('DELETE FROM account_deletion_intents WHERE account_id = $1', [
        input.accountId,
      ]);
      await client.query('DELETE FROM organization_members WHERE account_id = $1', [
        input.accountId,
      ]);
      await client.query('DELETE FROM project_members WHERE account_id = $1', [input.accountId]);
      await client.query(
        `UPDATE organization_invitations SET status = 'revoked'
         WHERE status = 'pending' AND invited_email = $1`,
        [input.accountEmail],
      );
      await client.query(
        `UPDATE security_audit_events SET actor_account_id = NULL, target_account_id = NULL
         WHERE actor_account_id = $1 OR target_account_id = $1`,
        [input.accountId],
      );
      await client.query(
        `UPDATE accounts
         SET email = 'deleted:' || account_id::text,
             email_normalized = 'deleted:' || account_id::text,
             verified_at = NULL,
             status = 'terminated'
         WHERE account_id = $1`,
        [input.accountId],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const code = error instanceof Error ? error.message : String(error);
      return { ok: false, errorCode: `postgres_cleanup_failed:${code}` };
    } finally {
      client.release();
    }
  }
}
