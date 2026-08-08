import { enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';

export const OPERATION_ID_REQUEST_PASSWORD_RESET = 'identityRequestPasswordReset' as const;
export const OPERATION_ID_CONFIRM_PASSWORD_RESET = 'identityConfirmPasswordReset' as const;
export const OPERATION_ID_CHANGE_PASSWORD = 'identityChangePassword' as const;

export const identityRequestPasswordResetRequest = obj({
  email: str(3, 320),
  idempotencyKey,
});

// Uniform response: never reveals whether the account exists (enumeration-safe, A3).
export const identityRequestPasswordResetResponse = obj({
  serverTime: utcTimestamp,
  nextRequestAllowedAt: optional(utcTimestamp),
});

// The one-time reset token is carried by the HttpOnly intent cookie, never in the body.
export const identityConfirmPasswordResetRequest = obj({
  newPassword: str(8, 256),
  idempotencyKey,
});

export const identityConfirmPasswordResetResponse = obj({
  status: enum_(['succeeded']),
  serverTime: utcTimestamp,
});

export const identityChangePasswordRequest = obj({
  currentPassword: str(8, 256),
  newPassword: str(8, 256),
  idempotencyKey,
});

export const identityChangePasswordResponse = obj({
  status: enum_(['succeeded']),
  sessionImpact: enum_(['revoked_all']),
});
