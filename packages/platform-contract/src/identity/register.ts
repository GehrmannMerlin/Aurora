import { z } from 'zod';
import { enum_, obj, optional, str } from '../common/schema.js';
import type { SchemaDef } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { AccountId, OrganizationId } from '../common/identifiers.js';

export const OPERATION_ID_REGISTER = 'identityRegister' as const;

// A freshly registered account is always unverified (A1). The literal is part of the closed
// contract: verificationStatus.verified cannot be true until the email intent is confirmed.
const verificationPending: SchemaDef = {
  zod: z.literal(false),
  openapi: { type: 'boolean', enum: [false] },
  meta: {},
};

export const identityRegisterRequest = obj({
  email: str(3, 320),
  password: str(8, 256),
  idempotencyKey,
});

export const identityRegisterResponse = obj({
  accountId: AccountId,
  // The personal workspace is an `organizations` row with kind='personal'; its id is an
  // OrganizationId-branded UUID.
  workspaceId: obj({ organizationId: OrganizationId }),
  emailMasked: str(3, 320),
  deliveryStatus: enum_(['queued']),
  verificationStatus: obj({ verified: verificationPending, reason: str(1, 64) }),
  resendAvailableAt: optional(utcTimestamp),
  serverTime: utcTimestamp,
});
