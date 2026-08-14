import { z } from 'zod';
import { enum_, obj, str } from '../common/schema.js';
import type { SchemaDef } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { AccountId } from '../common/identifiers.js';
import { utcTimestamp } from '../common/time.js';

export const OPERATION_ID_CONFIRM_EMAIL_VERIFICATION = 'identityConfirmEmailVerification' as const;
export const OPERATION_ID_RESEND_EMAIL_VERIFICATION = 'identityResendEmailVerification' as const;

// A confirmed verification intent is always verified (A1). The literal is part of the closed
// contract: verificationStatus.verified cannot be false after confirmation.
const verifiedTrue: SchemaDef = {
  zod: z.literal(true),
  openapi: { type: 'boolean', enum: [true] },
  meta: {},
};

// The one-time verification token is carried by the HttpOnly intent cookie, never in the body.
export const identityConfirmEmailVerificationRequest = obj({
  idempotencyKey,
});

export const identityConfirmEmailVerificationResponse = obj({
  verificationStatus: obj({ verified: verifiedTrue }),
  account: obj({ accountId: AccountId, email: str(3, 320), verified: verifiedTrue }),
});

export const identityResendEmailVerificationRequest = obj({ idempotencyKey });

export const identityResendEmailVerificationResponse = obj({
  emailMasked: str(3, 320),
  deliveryStatus: enum_(['queued']),
  resendAvailableAt: utcTimestamp,
  serverTime: utcTimestamp,
});
