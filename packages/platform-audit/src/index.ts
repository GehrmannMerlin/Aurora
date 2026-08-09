/**
 * @aurora/platform-audit — Aurora platform security-audit read data layer
 * (PLT-04 B7).
 *
 * This module is the package root. It exposes:
 * - `listAuditEvents` — the READ-ONLY B7 security timeline: redacted summaries
 *   (action/result/occurredAt/actorMasked/targetProjectRef), cursor-based
 *   pagination, org scoping, and the B7 1-year retention window. This package
 *   NEVER writes audit rows — `insertAuditEvent` is owned by the PLT-03 /
 *   PLT-04 management packages and only ever runs inside a management command
 *   transaction (PRD §13.3);
 * - the pure redaction/cursor helpers (`maskActor`, `normalizeAuditResult`,
 *   `encodeAuditCursor`, `decodeAuditCursor`);
 * - the stable PlatformAuditError surface.
 *
 * This is a data-layer package: it depends only on {protocol} workspace
 * packages (none currently) and plain `pg`. It never imports or declares
 * `@aurora/platform-contract` (contract layer) per Workspace Policy
 * (data → {protocol}).
 */
export const PLATFORM_AUDIT_PACKAGE = '@aurora/platform-audit' as const;

export const PLATFORM_AUDIT_VERSION = '0.0.0' as const;

export { PlatformAuditError, type PlatformAuditErrorKind } from './errors.js';

export {
  AUDIT_MASKED_UNKNOWN_ACTOR,
  AUDIT_RESULT_DEFAULT,
  AUDIT_RESULT_VALUES,
  AUDIT_RETENTION_MS,
  DEFAULT_AUDIT_PAGE_SIZE,
  MAX_AUDIT_PAGE_SIZE,
  decodeAuditCursor,
  encodeAuditCursor,
  listAuditEvents,
  maskActor,
  normalizeAuditResult,
  type AuditEventSummary,
  type AuditPagination,
  type AuditResult,
  type DecodedAuditCursor,
  type ListAuditEventsInput,
  type ListAuditEventsResult,
} from './repositories/audit.js';
