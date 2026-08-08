import { bool, enum_, obj, optional, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { AccountId } from '../common/identifiers.js';
import { navigationTargets, routeTarget } from '../common/navigation.js';

export const OPERATION_ID_LOGIN = 'identityLogin' as const;
export const OPERATION_ID_LOGOUT = 'identityLogout' as const;

const accountSummary = obj({
  accountId: AccountId,
  email: str(3, 320),
  verified: bool(),
});

export const identityLoginRequest = obj({
  email: str(3, 320),
  password: str(8, 256),
  idempotencyKey,
});

export const identityLoginResponse = obj({
  account: accountSummary,
  authentication: enum_(['pending_verification', 'authenticated', 'restricted']),
  session: obj({
    expiresAt: utcTimestamp,
    // Optional-until-known: the session shape matches identityGetSession exactly (session.ts).
    rotationDueAt: optional(utcTimestamp),
  }),
  csrf: str(1, 256),
  // The navigation target list matches identityGetSession exactly (session.ts):
  // a resolved array of RouteTargets, never a single target.
  navigation: navigationTargets,
  continuation: optional(obj({ target: routeTarget, kind: enum_(['invitation', 'return_to']) })),
});

export const identityLogoutResponse = obj({
  status: enum_(['succeeded']),
  serverTime: utcTimestamp,
});
