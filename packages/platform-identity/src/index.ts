/**
 * @aurora/platform-identity — Aurora platform identity, authentication and
 * invitation data layer.
 *
 * This module is the package root. It exposes:
 * - Argon2id password hashing/verification (`hashPassword`/`verifyPassword`);
 * - one-time intent token generation + email canonicalization
 *   (`createIntentToken`/`normalizeEmail`);
 * - repositories over the 11-table data model (accounts, intents,
 *   organizations, invitations, audit, idempotency, outbox);
 * - the stable PlatformIdentityError surface.
 *
 * This is a data-layer package: it depends only on {protocol} workspace
 * packages (none currently) and plain `pg`. It never imports or declares
 * `@aurora/platform-contract` (contract layer) per Workspace Policy.
 */
export const PLATFORM_IDENTITY_PACKAGE = '@aurora/platform-identity' as const;

export const PLATFORM_IDENTITY_VERSION = '0.0.0' as const;

export { hashPassword, verifyPassword } from './password.js';

export { createIntentToken, normalizeEmail } from './intent-token.js';

export { PlatformIdentityError, type PlatformIdentityErrorKind } from './errors.js';

export {
  createAccount,
  findAccountByEmailNormalized,
  getAccountById,
  incrementSecurityVersion,
  updateAccountVerifiedAt,
  upsertAccountCredential,
  type AccountMutationResult,
  type AccountRow,
  type CreateAccountInput,
  type CreateAccountResult,
  type UpsertAccountCredentialInput,
} from './repositories/accounts.js';

export {
  consumeIntent,
  findEmailVerificationIntentByDigest,
  findPasswordResetIntentByDigest,
  insertEmailVerificationIntent,
  insertPasswordResetIntent,
  type ConsumeIntentInput,
  type ConsumeIntentResult,
  type InsertIntentInput,
  type InsertIntentResult,
  type IntentKind,
  type IntentRow,
} from './repositories/intents.js';

export {
  createInvitation,
  createPersonalOrganization,
  findInvitationByDigest,
  findOrganizationById,
  insertOrganizationMembership,
  insertProjectMembership,
  updateInvitationStatus,
  type CreateInvitationInput,
  type CreateInvitationResult,
  type CreatePersonalOrganizationInput,
  type CreatePersonalOrganizationResult,
  type InsertMembershipInput,
  type InsertProjectMembershipInput,
  type InvitationMutationResult,
  type InvitationRow,
  type MembershipMutationResult,
  type OrganizationRole,
  type OrganizationRow,
  type ProjectRole,
} from './repositories/organizations.js';

export {
  insertAuditEvent,
  type InsertAuditEventInput,
  type InsertAuditEventResult,
} from './repositories/audit.js';

export {
  createIdempotencyRecord,
  findIdempotencyRecord,
  updateIdempotencyResult,
  type CreateIdempotencyRecordInput,
  type CreateIdempotencyRecordResult,
  type IdempotencyRecordRow,
  type IdempotencyStatus,
  type UpdateIdempotencyResultInput,
  type UpdateIdempotencyResultResult,
} from './repositories/idempotency.js';

export {
  claimOutboxRows,
  insertOutboxRow,
  markOutboxResult,
  MAX_CLAIM_LIMIT,
  type ClaimOutboxRowsInput,
  type ClaimOutboxRowsResult,
  type InsertOutboxRowInput,
  type InsertOutboxRowResult,
  type MarkOutboxResultInput,
  type MarkOutboxResultResult,
  type OutboxRow,
  type OutboxStatus,
} from './repositories/outbox.js';
