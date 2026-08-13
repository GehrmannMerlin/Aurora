export interface CheckIngestionAdmissionInput {
  readonly requestId: string;
  /**
   * Number of events in the batch, used to rate-limit on the event rate the
   * target PostgreSQL can sustain (ING-13 approved parameter). Undefined (e.g.
   * malformed body not yet parsed) is treated as a single unit so a request
   * without a countable batch still consumes admission capacity.
   */
  readonly eventCount?: number;
}

export type CheckIngestionAdmissionResult =
  | { readonly status: 'allow' }
  | { readonly status: 'temporarilyRejected'; readonly retryAfterMs: number };

/**
 * Request admission port, reserved for 429. Production must configure a real
 * policy; tests and explicit configuration may use `allowAllIngestionAdmissionPolicy`.
 */
export interface IngestionAdmissionPolicy {
  check(input: CheckIngestionAdmissionInput): Promise<CheckIngestionAdmissionResult>;
}

/** Explicit allow-all implementation for tests and explicit configuration. */
export const allowAllIngestionAdmissionPolicy: IngestionAdmissionPolicy = {
  check: (): Promise<CheckIngestionAdmissionResult> => Promise.resolve({ status: 'allow' }),
};

/**
 * Typed admission policy configuration. Every numeric value is traceable to the
 * ING-13 target-PostgreSQL benchmark evidence; no magic numbers are introduced.
 */
export interface IngestionAdmissionPolicyConfig {
  /** Sustainable event rate (events/second) approved by ING-13 measurement. */
  readonly maxEventsPerSecond: number;
  /** Retry-After backoff (ms) returned on rate-limited (429) responses. */
  readonly retryAfterMs: number;
}

/**
 * Default production admission policy, frozen from ING-13 evidence:
 * `maxEventsPerSecond=400` = `approvedSustainableEventsPerSecond` (conservative
 * floor below the measured 422.7 ev/s no-contention point), `retryAfterMs=1000`
 * conservative one-second rate-limit backoff.
 */
export const DEFAULT_INGESTION_ADMISSION_POLICY_CONFIG: Readonly<IngestionAdmissionPolicyConfig> =
  Object.freeze({
    maxEventsPerSecond: 400,
    retryAfterMs: 1000,
  });

/** Injectable clock for deterministic admission-policy tests. */
export interface IngestionAdmissionPolicyDeps {
  readonly now?: () => number;
}

function freezeConfig(value: IngestionAdmissionPolicyConfig): Readonly<IngestionAdmissionPolicyConfig> {
  if (!Number.isSafeInteger(value.maxEventsPerSecond) || value.maxEventsPerSecond <= 0) {
    throw new Error('invalid admission policy config: maxEventsPerSecond must be a positive integer');
  }
  if (!Number.isSafeInteger(value.retryAfterMs) || value.retryAfterMs <= 0) {
    throw new Error('invalid admission policy config: retryAfterMs must be a positive integer');
  }
  return Object.freeze({ maxEventsPerSecond: value.maxEventsPerSecond, retryAfterMs: value.retryAfterMs });
}

/**
 * In-memory token-bucket rate limiter over the sustainable event rate. The
 * bucket holds `maxEventsPerSecond` tokens and refills at that rate per second;
 * each request consumes `eventCount` (default 1) tokens. Over-limit requests are
 * rejected with `temporarilyRejected{retryAfterMs}` so the caller maps to 429 +
 * Retry-After without changing existing HTTP semantics. Single-host in-memory by
 * design: no Redis counter or quota system is introduced.
 */
export function createIngestionAdmissionPolicy(
  config: IngestionAdmissionPolicyConfig,
  deps: IngestionAdmissionPolicyDeps = {},
): IngestionAdmissionPolicy {
  const frozen = freezeConfig(config);
  const now = deps.now ?? (() => Date.now());

  let tokens = frozen.maxEventsPerSecond;
  let lastRefillMs = now();

  return {
    check(input: CheckIngestionAdmissionInput): Promise<CheckIngestionAdmissionResult> {
      const currentMs = now();
      const elapsedMs = Math.max(0, currentMs - lastRefillMs);
      const refilled = (elapsedMs / 1000) * frozen.maxEventsPerSecond;
      tokens = Math.min(frozen.maxEventsPerSecond, tokens + refilled);
      lastRefillMs = currentMs;

      const cost = Math.max(1, input.eventCount ?? 1);
      if (tokens >= cost) {
        tokens -= cost;
        return Promise.resolve({ status: 'allow' });
      }
      return Promise.resolve({
        status: 'temporarilyRejected',
        retryAfterMs: frozen.retryAfterMs,
      });
    },
  };
}
