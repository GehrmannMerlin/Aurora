import { describe, expect, it } from 'vitest';
import { identityGetSessionResponse } from '../../src/identity/session.js';
import { navigationGetContextResponse } from '../../src/identity/navigation-context.js';
import { identityRegisterResponse } from '../../src/identity/register.js';
import { identityLoginResponse, identityLogoutResponse } from '../../src/identity/login.js';
import {
  identityChangePasswordResponse,
  identityConfirmPasswordResetResponse,
  identityRequestPasswordResetResponse,
} from '../../src/identity/password.js';
import { identityConfirmEmailVerificationResponse } from '../../src/identity/email-verification.js';
import { organizationAcceptInvitationResponse } from '../../src/identity/invitation.js';
import { auroraProblem } from '../../src/common/problem-details.js';
import {
  validSessionSamples,
  invalidSessionSamples,
  validNavigationSamples,
  invalidNavigationSamples,
  validProblemSamples,
  validRegisterSamples,
  validLoginSamples,
  validLogoutSamples,
  validRequestPasswordResetSamples,
  validConfirmPasswordResetSamples,
  validChangePasswordSamples,
  validConfirmEmailVerificationSamples,
  validAcceptInvitationSamples,
} from '../../src/contract-testkit/index.js';

describe('contract testkit', () => {
  it('valid samples pass their schemas', () => {
    for (const s of validSessionSamples)
      expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validNavigationSamples)
      expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validProblemSamples) expect(auroraProblem.zod.safeParse(s).success).toBe(true);
    for (const s of validRegisterSamples)
      expect(identityRegisterResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validLoginSamples)
      expect(identityLoginResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validLogoutSamples)
      expect(identityLogoutResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validRequestPasswordResetSamples)
      expect(identityRequestPasswordResetResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validConfirmPasswordResetSamples)
      expect(identityConfirmPasswordResetResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validChangePasswordSamples)
      expect(identityChangePasswordResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validConfirmEmailVerificationSamples)
      expect(identityConfirmEmailVerificationResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validAcceptInvitationSamples)
      expect(organizationAcceptInvitationResponse.zod.safeParse(s).success).toBe(true);
  });

  it('invalid samples fail their schemas', () => {
    for (const s of invalidSessionSamples)
      expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(false);
    for (const s of invalidNavigationSamples)
      expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(false);
  });

  it('samples contain no secrets', () => {
    const all = JSON.stringify([
      ...validSessionSamples,
      ...validNavigationSamples,
      ...validRegisterSamples,
      ...validLoginSamples,
      ...validLogoutSamples,
      ...validRequestPasswordResetSamples,
      ...validConfirmPasswordResetSamples,
      ...validChangePasswordSamples,
      ...validConfirmEmailVerificationSamples,
      ...validAcceptInvitationSamples,
    ]);
    expect(all).not.toMatch(/aurora_ingest_|Bearer |secret|password|sessionId/i);
  });
});
