import type { Pool } from 'pg';
import type { SessionCookieOptions, SessionStore } from '@aurora/platform-session';
import type { EmailDeliveryPort } from '@aurora/platform-email';
import type { SourceMapObjectStoragePort } from '@aurora/platform-releases';
import type { PlatformApiConfig } from './config.js';
import type { PlatformRequestIdProvider } from './request-id.js';
import type { InMemoryRateLimiter } from './rate-limit.js';

/**
 * Immutable per-request service context passed to route handlers. Never shares
 * mutable state across requests (accepted ADR-026 实施约束).
 */
export interface PlatformApiRouteDependencies {
  readonly config: PlatformApiConfig;
  readonly pool: Pool;
  readonly sessionStore: SessionStore;
  readonly emailPort: EmailDeliveryPort;
  /** DAT-18 private Source Map object storage (disposable in-memory in tests/dev). */
  readonly sourceMapObjectStorage: SourceMapObjectStoragePort;
  readonly requestIdProvider: PlatformRequestIdProvider;
  readonly now: () => Date;
  readonly cookieOptions: SessionCookieOptions;
  /** In-memory anti-abuse rate limiter for the public auth commands. */
  readonly rateLimiter: InMemoryRateLimiter;
}
