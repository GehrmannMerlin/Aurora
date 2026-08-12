/**
 * @aurora/platform-admin — Aurora platform admin identity and platform-level
 * audit data layer (PLT-10a, ADR-034).
 *
 * This module is the package root. It exposes the platform admin repository
 * (explicit account-level capability on `platform_admins`, fully decoupled from
 * org/project roles, plus the controlled bootstrap entry) and the platform
 * audit repository (`platform_audit_events`: insert inside the caller's
 * transaction, keyset-paginated query).
 */
export const PLATFORM_ADMIN_PACKAGE = '@aurora/platform-admin' as const;

export const PLATFORM_ADMIN_VERSION = '0.0.0' as const;

export { PlatformAdminError, type PlatformAdminErrorKind } from './errors.js';

export {
  bootstrapPlatformAdmins,
  countPlatformAdmins,
  grantPlatformAdmin,
  isPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
  type BootstrapPlatformAdminsResult,
  type GrantPlatformAdminResult,
  type ListPlatformAdminsResult,
  type PlatformAdminSummary,
  type RevokePlatformAdminResult,
} from './repositories/admins.js';

export {
  insertPlatformAuditEvent,
  PLATFORM_AUDIT_ACTIONS,
  queryPlatformAuditEvents,
  type InsertPlatformAuditEventInput,
  type PlatformAuditAction,
  type PlatformAuditEvent,
  type PlatformAuditEventsPage,
  type QueryPlatformAuditEventsInput,
} from './repositories/audit.js';
