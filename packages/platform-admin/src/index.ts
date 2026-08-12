/**
 * @aurora/platform-admin — Aurora platform admin identity and platform-level
 * audit data layer (PLT-10a, ADR-034).
 *
 * This module is the package root. Task 2 exposes the platform admin
 * repository: explicit account-level capability (`platform_admins`), fully
 * decoupled from org/project roles, plus the controlled bootstrap entry that
 * writes the `admin_bootstrapped` audit inline.
 *
 * The platform audit read/write repository (Task 3) will be re-exported from
 * here in a later task; this task exports the admins surface only.
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
