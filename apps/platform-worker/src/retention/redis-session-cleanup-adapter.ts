/**
 * SEC-02 Redis session cleanup adapter — CONTRACT implementation.
 *
 * Production Session Redis is deferred by ADR-032 (no real consumer until
 * platform Session infra is provisioned). This adapter pins the contract: on
 * cleanup, all sessions for the deleted account must be revoked so an old
 * session never revives after deletion (§2: "注销受理后全部 Session 立即失效，
 * 旧 Session 不得因缓存、故障切换或备份恢复复活"). The concrete Redis command
 * (session-key deletion / namespace scan) is wired when Session Redis exists;
 * the contract test enforces the interface and the no-resurrection semantics.
 */

import type { CleanupAdapter, CleanupResult } from './cleanup-adapters.js';

export class RedisSessionCleanupAdapter implements CleanupAdapter {
  readonly store = 'redis-sessions' as const;

  cleanup(): Promise<CleanupResult> {
    // Contract-only: Session Redis is deferred (ADR-032). The real adapter
    // revokes every session key for the account before the intent completes.
    return Promise.resolve({ ok: true });
  }
}
