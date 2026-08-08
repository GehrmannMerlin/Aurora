import { randomBytes } from 'node:crypto';
import type { RetryBackoffEntropyProvider } from './retry-backoff-types.js';

/**
 * Node crypto entropy adapter for server runtime backoff jitter. Reads 4 random
 * bytes as an unsigned 32-bit integer and normalizes into [0, 1): the max value
 * 2^32 - 1 divided by 2^32 is strictly below 1, so the result never reaches 1.
 * Never uses the insecure global random number source, never keeps mutable
 * global state, and never throws to the caller for a normal draw.
 */
export function createNodeCryptoEntropyProvider(): RetryBackoffEntropyProvider {
  return {
    next(): number {
      const bytes = randomBytes(4);
      const value =
        ((bytes[0] ?? 0) * 2 ** 24) +
        ((bytes[1] ?? 0) * 2 ** 16) +
        ((bytes[2] ?? 0) * 2 ** 8) +
        (bytes[3] ?? 0);
      const fraction = value / 2 ** 32;
      if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1) {
        // Defensive: never return a value outside [0, 1).
        return 0;
      }
      return fraction;
    },
  };
}
