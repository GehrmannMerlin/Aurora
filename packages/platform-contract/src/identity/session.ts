import { bool, enum_, obj, optional, str } from '../common/schema.js';
import { AccountId } from '../common/identifiers.js';
import { utcTimestamp } from '../common/time.js';
import { navigationTargets } from '../common/navigation.js';

export const OPERATION_ID_SESSION = 'identityGetSession' as const;

const accountSummary = obj({
  accountId: AccountId,
  email: str(3, 320),
  emailMasked: str(3, 320),
  verified: bool(),
});

const sessionInfo = obj({
  expiresAt: utcTimestamp,
  rotationDueAt: optional(utcTimestamp),
});

const emailVerificationTiming = obj({
  serverTime: utcTimestamp,
  resendAvailableAt: optional(utcTimestamp),
});

export const identityGetSessionResponse = obj({
  account: accountSummary,
  authentication: enum_(['pending_verification', 'authenticated', 'restricted']),
  session: sessionInfo,
  emailVerification: optional(emailVerificationTiming),
  csrf: str(1, 256),
  navigation: navigationTargets,
});
