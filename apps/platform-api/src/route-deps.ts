import type { Pool } from 'pg';
import type { SessionCookieOptions, SessionStore } from '@aurora/platform-session';
import type { EmailDeliveryPort } from '@aurora/platform-email';
import type { PlatformApiConfig } from './config.js';
import type { PlatformRequestIdProvider } from './request-id.js';

/**
 * Immutable per-request service context passed to route handlers. Never shares
 * mutable state across requests (accepted ADR-026 实施约束).
 */
export interface PlatformApiRouteDependencies {
  readonly config: PlatformApiConfig;
  readonly pool: Pool;
  readonly sessionStore: SessionStore;
  readonly emailPort: EmailDeliveryPort;
  readonly requestIdProvider: PlatformRequestIdProvider;
  readonly now: () => Date;
  readonly cookieOptions: SessionCookieOptions;
}
