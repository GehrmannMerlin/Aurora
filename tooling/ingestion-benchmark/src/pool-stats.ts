import type { Pool } from 'pg';
import type { PoolStats } from './types.js';

export interface PoolStatsTracker {
  sample(): PoolStats;
  peak(): PoolStats;
}

/**
 * Periodically sample a pg Pool's connection counts. Uses pg's public
 * pool.stats field (totalCount/idleCount/waitingCount); no internal access.
 */
export function createPoolStatsTracker(pool: Pool): PoolStatsTracker {
  let peakValue: PoolStats = { totalCount: 0, idleCount: 0, waitingCount: 0 };

  const record = (stats: PoolStats): void => {
    peakValue = {
      totalCount: Math.max(peakValue.totalCount, stats.totalCount),
      idleCount: Math.max(peakValue.idleCount, stats.idleCount),
      waitingCount: Math.max(peakValue.waitingCount, stats.waitingCount),
    };
  };

  return {
    sample(): PoolStats {
      const stats: PoolStats = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
      };
      record(stats);
      return stats;
    },
    peak(): PoolStats {
      return { ...peakValue };
    },
  };
}
