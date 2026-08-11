/**
 * SEC-02 audit cleanup adapter — REAL implementation
 * (account-deletion-and-data-lifecycle §7).
 *
 * Records a security-audit event for the cross-store cleanup completion. The
 * event carries only a minimal anonymous subject reference (accountId) — never
 * email, password, verification URL, session, token or monitoring content.
 * 1-year retention is a policy on the audit store, not per-row logic here.
 */

import type { Pool } from 'pg';
import type { CleanupAdapter, CleanupInput, CleanupResult } from './cleanup-adapters.js';

export class AuditCleanupAdapter implements CleanupAdapter {
  readonly store = 'audit' as const;

  constructor(private readonly pool: Pool) {}

  async cleanup(input: CleanupInput): Promise<CleanupResult> {
    try {
      await this.pool.query(
        `INSERT INTO security_audit_events (actor_account_id, action, target_account_id, details)
         VALUES ($1, 'cleanup_completed', $1, $2::jsonb)`,
        [input.accountId, JSON.stringify({ lifecycle: 'account-deletion', stores: ['postgres'] })],
      );
      return { ok: true };
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      return { ok: false, errorCode: `audit_cleanup_failed:${code}` };
    }
  }
}
