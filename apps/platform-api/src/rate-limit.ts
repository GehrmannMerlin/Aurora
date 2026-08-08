/**
 * In-memory sliding-window rate limiter (per operation + IP + email-normalized),
 * used as an anti-abuse stub for the public auth commands (register / login /
 * request-password-reset). The exact window and limit are implementation-detail
 * defaults; ADR-030 marks production values `requires-benchmark`, so this is an
 * in-memory stub intentionally: it is per-process, not shared, and is not a
 * production-capable distributed limiter. It never logs any input.
 */
export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds?: number;
}

export interface RateLimiterOptions {
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Maximum requests allowed per window per key. */
  readonly max: number;
  /** Buckets above this many are pruned opportunistically on each check. */
  readonly maxBuckets?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly maxBuckets: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.maxBuckets = options.maxBuckets ?? 10_000;
  }

  /**
   * Check a keyed bucket at `now` (epoch ms). When allowed the bucket is
   * incremented; when exhausted a `retryAfterSeconds` is returned so the caller
   * can surface the RFC 9457 `retryAfter` extension safely.
   */
  check(key: string, now: number): RateLimitResult {
    this.prune(now);
    const existing = this.buckets.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }
    if (existing.count >= this.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    existing.count += 1;
    return { allowed: true };
  }

  private prune(now: number): void {
    if (this.buckets.size < this.maxBuckets) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
