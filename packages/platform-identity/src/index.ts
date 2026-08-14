/**
 * @aurora/platform-identity — Aurora platform identity, authentication and
 * invitation data layer.
 *
 * This module is the package root. It exposes:
 * - Argon2id password hashing/verification (`hashPassword`/`verifyPassword`);
 * - one-time intent token generation + email canonicalization
 *   (`createIntentToken`/`normalizeEmail`);
 * - repositories over the data model (accounts, intents, deletion intents,
 *   cleanup handoffs, organizations, invitations, audit, idempotency, outbox);
 * - the A5 deletion state-machine pure function (`decideDeletionFinalization`);
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
  getAccountByIdForUpdate,
  incrementSecurityVersion,
  recordDeletionRequest,
  recordDeletionTermination,
  updateAccountStatus,
  updateAccountVerifiedAt,
  upsertAccountCredential,
  type AccountMutationResult,
  type AccountRow,
  type AccountStatus,
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
  supersedeEmailVerificationIntents,
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
  getEmailVerificationResendState,
  insertOutboxRow,
  markOutboxResult,
  supersedePendingEmailVerificationOutbox,
  MAX_CLAIM_LIMIT,
  type ClaimOutboxRowsInput,
  type ClaimOutboxRowsResult,
  type EmailVerificationResendState,
  type GetEmailVerificationResendStateInput,
  type InsertOutboxRowInput,
  type InsertOutboxRowResult,
  type MarkOutboxResultInput,
  type MarkOutboxResultResult,
  type OutboxRow,
  type OutboxStatus,
} from './repositories/outbox.js';

export {
  consumeDeletionIntent,
  findDeletionIntentByDigest,
  insertDeletionIntent,
  type ConsumeDeletionIntentInput,
  type ConsumeDeletionIntentResult,
  type DeletionIntentKind,
  type DeletionIntentRow,
  type InsertDeletionIntentInput,
  type InsertDeletionIntentResult,
} from './repositories/deletion-intents.js';

export {
  findCleanupHandoffByAccount,
  insertCleanupHandoff,
  type CleanupHandoffRow,
  type CleanupHandoffStatus,
  type InsertCleanupHandoffInput,
  type InsertCleanupHandoffResult,
} from './repositories/cleanup-handoffs.js';

export {
  decideDeletionFinalization,
  type DecideDeletionFinalizationInput,
  type DeletionFinalizationDecision,
} from './deletion-state-machine.js';
