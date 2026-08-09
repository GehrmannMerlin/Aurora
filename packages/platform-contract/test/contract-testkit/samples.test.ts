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
import { organizationListProjectsResponse } from '../../src/organization/workspace.js';
import { organizationListMembersResponse } from '../../src/organization/members.js';
import { organizationInviteMemberResponse } from '../../src/organization/invitations.js';
import { organizationUpdateTimezoneResponse } from '../../src/organization/settings.js';
import { projectGovernanceListTrashResponse } from '../../src/project-governance/trash.js';
import { projectGovernanceRestoreProjectResponse } from '../../src/project-governance/trash.js';
import { credentialsListPrivateTokensResponse } from '../../src/credentials/private-tokens.js';
import { credentialsCreatePrivateTokenResponse } from '../../src/credentials/private-tokens.js';
import { auditListSecurityAuditResponse } from '../../src/audit/security-audit.js';
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
  validListProjectsSamples,
  validListMembersSamples,
  validInviteMemberSamples,
  validUpdateTimezoneSamples,
  validListTrashSamples,
  validRestoreProjectSamples,
  validListPrivateTokensSamples,
  validCreatePrivateTokenSamples,
  validListSecurityAuditSamples,
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
    for (const s of validListProjectsSamples)
      expect(organizationListProjectsResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validListMembersSamples)
      expect(organizationListMembersResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validInviteMemberSamples)
      expect(organizationInviteMemberResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validUpdateTimezoneSamples)
      expect(organizationUpdateTimezoneResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validListTrashSamples)
      expect(projectGovernanceListTrashResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validRestoreProjectSamples)
      expect(projectGovernanceRestoreProjectResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validListPrivateTokensSamples)
      expect(credentialsListPrivateTokensResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validCreatePrivateTokenSamples)
      expect(credentialsCreatePrivateTokenResponse.zod.safeParse(s).success).toBe(true);
    for (const s of validListSecurityAuditSamples)
      expect(auditListSecurityAuditResponse.zod.safeParse(s).success).toBe(true);
  });

  it('invalid samples fail their schemas', () => {
    for (const s of invalidSessionSamples)
      expect(identityGetSessionResponse.zod.safeParse(s).success).toBe(false);
    for (const s of invalidNavigationSamples)
      expect(navigationGetContextResponse.zod.safeParse(s).success).toBe(false);
  });

  it('samples contain no secrets', () => {
    // validCreatePrivateTokenSamples is intentionally excluded: its one-time tokenPlaintext is the
    // one legal secret-bearing sample and is validated against its own schema above.
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
      ...validListProjectsSamples,
      ...validListMembersSamples,
      ...validInviteMemberSamples,
      ...validUpdateTimezoneSamples,
      ...validListTrashSamples,
      ...validRestoreProjectSamples,
      ...validListPrivateTokensSamples,
      ...validListSecurityAuditSamples,
    ]);
    expect(all).not.toMatch(/aurora_ingest_|Bearer |secret|password|sessionId/i);
    // The list tokens response is metadata-only: never a plaintext or digest.
    expect(JSON.stringify(validListPrivateTokensSamples)).not.toMatch(
      /tokenPlaintext|tokenDigest|aurora_pt_/i,
    );
  });
});
