import { http, HttpResponse, type JsonBodyType } from 'msw';
import {
  validAcceptInvitationSamples,
  validChangePasswordSamples,
  validConfirmEmailVerificationSamples,
  validConfirmPasswordResetSamples,
  validCreatePrivateTokenSamples,
  validInviteMemberSamples,
  validListMembersSamples,
  validListPrivateTokensSamples,
  validListProjectsSamples,
  validListSecurityAuditSamples,
  validListTrashSamples,
  validLoginSamples,
  validLogoutSamples,
  validNavigationSamples,
  validRegisterSamples,
  validRequestPasswordResetSamples,
  validRestoreProjectSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';

export interface MockScope {
  readonly type: 'workspace' | 'organization' | 'project';
  readonly id?: string;
}

const MOCK_SCOPE_STORAGE_KEY = '__aurora_mock_scope';
const MOCK_SESSION_STORAGE_KEY = '__aurora_mock_session_authenticated';
const MOCK_DELETION_PREFLIGHT_STORAGE_KEY = '__aurora_mock_deletion_preflight';

function readStoredScope(): MockScope {
  try {
    const raw = sessionStorage.getItem(MOCK_SCOPE_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { type?: string; id?: string } | string | null;
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        (parsed.type === 'workspace' || parsed.type === 'organization' || parsed.type === 'project')
      ) {
        return parsed.id === undefined
          ? { type: parsed.type }
          : { type: parsed.type, id: parsed.id };
      }
    }
  } catch {
    // storage may be unavailable (non-browser harness); fall through to the default
  }
  return { type: 'project', id: 'prj_test_1' };
}

function readStoredSessionAuthenticated(): boolean {
  try {
    const raw = sessionStorage.getItem(MOCK_SESSION_STORAGE_KEY);
    if (raw !== null) return raw === 'true';
  } catch {
    // storage may be unavailable; default to an authenticated session
  }
  return true;
}

function readStoredDeletionPreflight(): 'ready' | 'blocked' {
  try {
    const raw = sessionStorage.getItem(MOCK_DELETION_PREFLIGHT_STORAGE_KEY);
    if (raw === 'blocked') return 'blocked';
    if (raw === 'ready') return 'ready';
  } catch {
    // storage may be unavailable; default to the ready projection
  }
  return 'ready';
}

let mockScope: MockScope = readStoredScope();

const navigationBody = JSON.parse(JSON.stringify(validNavigationSamples[0])) as {
  currentScope: unknown;
};

export const handlerControls = {
  delayMs: 0,
  sessionRequests: 0,
  registerRequests: 0,
  loginRequests: 0,
  logoutRequests: 0,
  confirmEmailRequests: 0,
  requestPasswordResetRequests: 0,
  confirmPasswordResetRequests: 0,
  changePasswordRequests: 0,
  acceptInvitationRequests: 0,
  intentLinkRequests: 0,
  listProjectsRequests: 0,
  createProjectRequests: 0,
  listMembersRequests: 0,
  inviteMemberRequests: 0,
  revokeInvitationRequests: 0,
  resendInvitationRequests: 0,
  changeRoleRequests: 0,
  removeMemberRequests: 0,
  transferOwnershipRequests: 0,
  updateTimezoneRequests: 0,
  listPrivateTokensRequests: 0,
  createPrivateTokenRequests: 0,
  revokePrivateTokenRequests: 0,
  listSecurityAuditRequests: 0,
  listTrashRequests: 0,
  restoreProjectRequests: 0,
  deletionPreflightRequests: 0,
  requestAccountDeletionRequests: 0,
  deleteAccountRequests: 0,
  cancelDeletionRequests: 0,
  /** Toggle for the session projection: true = authenticated, false = 401. */
  sessionAuthenticated: readStoredSessionAuthenticated(),
  /** Toggle for the A5 deletion preflight projection: ready = no blocker. */
  deletionPreflightStatus: readStoredDeletionPreflight(),
};

const unauthenticatedProblem = {
  type: 'about:blank',
  title: 'Authentication required',
  status: 401,
  detail: 'No active session.',
  code: 'authentication',
  requestId: 'req_test_unauth',
};

function persistSessionAuthenticated(value: boolean): void {
  handlerControls.sessionAuthenticated = value;
  try {
    sessionStorage.setItem(MOCK_SESSION_STORAGE_KEY, String(value));
  } catch {
    // storage unavailable; the module flag still applies for this page lifetime
  }
}

function persistDeletionPreflight(status: 'ready' | 'blocked'): void {
  handlerControls.deletionPreflightStatus = status;
  try {
    sessionStorage.setItem(MOCK_DELETION_PREFLIGHT_STORAGE_KEY, status);
  } catch {
    // storage unavailable; the module flag still applies for this page lifetime
  }
}

export function setMockScope(scope: MockScope): void {
  mockScope = scope;
  try {
    sessionStorage.setItem(MOCK_SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // storage may be unavailable in some harnesses; the module state still applies
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maybeDelay(): Promise<void> {
  return handlerControls.delayMs > 0 ? delay(handlerControls.delayMs) : Promise.resolve();
}

const INTENT_LINK_RESPONSES = {
  email_verification: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
  },
  password_reset: { status: 'valid', csrf: 'csrf_intent_token' },
  organization_invitation: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    organizationName: 'Acme',
    role: 'member',
  },
  deletion_cancel: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    intentKind: 'deletion_cancel',
  },
  deletion_request: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    intentKind: 'deletion_request',
  },
} as const;

// A5 deletion preflight projections (contract §5.2): ready = no unique-owner
// blocker; blocked = the blocking orgs the account still owns outright.
const DELETION_PREFLIGHT_REQUIRED_LIFECYCLE = {
  coolingHours: 168,
  onlineCleanupDays: 7,
  auditRetentionYears: 1,
  backupRetentionDays: 35,
} as const;

const DELETION_PREFLIGHT_READY = {
  status: 'ready',
  requiredLifecycle: DELETION_PREFLIGHT_REQUIRED_LIFECYCLE,
  serverTime: '2026-08-09T01:00:00.000Z',
} as const;

const DELETION_PREFLIGHT_BLOCKED = {
  status: 'blocked',
  blockingOrganizations: [
    { organizationId: 'org_test_1', organizationName: 'Acme', organizationKind: 'organization' },
  ],
  requiredLifecycle: DELETION_PREFLIGHT_REQUIRED_LIFECYCLE,
  serverTime: '2026-08-09T01:00:00.000Z',
} as const;

// A5 request-email success: the confirmation email is sent to the masked
// recipient (mirrors the real contract shape; no full email, no token).
const REQUEST_ACCOUNT_DELETION_SUCCESS = {
  status: 'succeeded',
  maskedEmail: 'us**@example.invalid',
  resendAvailableAt: '2026-08-09T01:01:00.000Z',
} as const;

// A5 delete-command success: account enters the server-authoritative cooling
// window and every session is revoked (mirrors the real contract shape).
const DELETE_ACCOUNT_SUCCESS = {
  status: 'succeeded',
  accountStatus: 'deletion_cooling',
  deletionRequestedAt: '2026-08-09T01:00:00.000Z',
  deletionCoolingEndsAt: '2026-08-16T01:00:00.000Z',
  sessionImpact: 'revoked_all',
} as const;

// A5 cancel-command success: the account returns to active and every session is
// revoked (the user must re-login; mirrors the real contract shape).
const CANCEL_DELETION_SUCCESS = {
  status: 'succeeded',
  accountStatus: 'active',
  sessionImpact: 'revoked_all',
} as const;

export function createPlatformHandlers() {
  return [
    http.get('/api/platform/v1/session', async () => {
      handlerControls.sessionRequests += 1;
      if (handlerControls.delayMs > 0) await delay(handlerControls.delayMs);
      if (!handlerControls.sessionAuthenticated) {
        return HttpResponse.json(unauthenticatedProblem as JsonBodyType, { status: 401 });
      }
      return HttpResponse.json(validSessionSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/navigation/context', async () => {
      await maybeDelay();
      const body = structuredClone(navigationBody);
      body.currentScope =
        mockScope.type === 'workspace'
          ? { type: 'workspace', lifecycle: 'active' }
          : { type: mockScope.type, id: mockScope.id, lifecycle: 'active' };
      return HttpResponse.json(body, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/register', async () => {
      handlerControls.registerRequests += 1;
      persistSessionAuthenticated(true);
      await maybeDelay();
      return HttpResponse.json(validRegisterSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/login', async () => {
      handlerControls.loginRequests += 1;
      persistSessionAuthenticated(true);
      await maybeDelay();
      return HttpResponse.json(validLoginSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/logout', async () => {
      handlerControls.logoutRequests += 1;
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(validLogoutSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/email/confirm', async () => {
      handlerControls.confirmEmailRequests += 1;
      persistSessionAuthenticated(true);
      await maybeDelay();
      return HttpResponse.json(validConfirmEmailVerificationSamples[0] as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/auth/password/request', async () => {
      handlerControls.requestPasswordResetRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validRequestPasswordResetSamples[0] as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/auth/password/confirm', async () => {
      handlerControls.confirmPasswordResetRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validConfirmPasswordResetSamples[0] as JsonBodyType, {
        status: 200,
      });
    }),
    http.post('/api/platform/v1/auth/password/change', async () => {
      handlerControls.changePasswordRequests += 1;
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(validChangePasswordSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/invitations/accept', async () => {
      handlerControls.acceptInvitationRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validAcceptInvitationSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/organizations/:organizationId/projects', async () => {
      handlerControls.listProjectsRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListProjectsSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/organizations/:organizationId/projects', async () => {
      handlerControls.createProjectRequests += 1;
      await maybeDelay();
      return HttpResponse.json(
        {
          projectId: 'prj_created_1',
          clientKeyPublicIdentifier: 'ck_pub_test_12345',
          defaultEnvironment: 'production',
          onboardingStatus: 'not_started',
          navigationTargets: [],
        } as JsonBodyType,
        { status: 200 },
      );
    }),
    http.get('/api/platform/v1/organizations/:organizationId/members', async () => {
      handlerControls.listMembersRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListMembersSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/organizations/:organizationId/invitations', async () => {
      handlerControls.inviteMemberRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validInviteMemberSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post(
      '/api/platform/v1/organizations/:organizationId/invitations/:invitationId/revoke',
      async ({ params }) => {
        handlerControls.revokeInvitationRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { status: 'succeeded', invitationId: params.invitationId } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/invitations/:invitationId/resend',
      async ({ params }) => {
        handlerControls.resendInvitationRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          {
            status: 'succeeded',
            invitationId: params.invitationId,
            expiresAt: '2026-08-23T01:00:00.000Z',
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/members/:accountId/role',
      async ({ params, request }) => {
        handlerControls.changeRoleRequests += 1;
        await maybeDelay();
        const body = (await request.json()) as { orgRole: string };
        return HttpResponse.json(
          {
            accountId: params.accountId,
            orgRole: body.orgRole,
            resourceVersion: '0',
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post(
      '/api/platform/v1/organizations/:organizationId/members/:accountId/remove',
      async ({ params }) => {
        handlerControls.removeMemberRequests += 1;
        await maybeDelay();
        return HttpResponse.json(
          { status: 'succeeded', accountId: params.accountId } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.post('/api/platform/v1/organizations/:organizationId/ownership', async ({ request }) => {
      handlerControls.transferOwnershipRequests += 1;
      await maybeDelay();
      const body = (await request.json()) as { newOwnerAccountId: string };
      return HttpResponse.json(
        {
          organizationId: 'org_test_1',
          ownerAccountId: body.newOwnerAccountId,
          resourceVersion: '1',
          navigationTargets: [],
        } as JsonBodyType,
        { status: 200 },
      );
    }),
    http.patch(
      '/api/platform/v1/organizations/:organizationId/settings/timezone',
      async ({ request }) => {
        handlerControls.updateTimezoneRequests += 1;
        await maybeDelay();
        const body = (await request.json()) as { timezone: string };
        return HttpResponse.json(
          {
            organizationId: 'org_test_1',
            timezone: body.timezone,
            resourceVersion: '1',
          } as JsonBodyType,
          { status: 200 },
        );
      },
    ),
    http.get('/api/platform/v1/organizations/:organizationId/private-tokens', async () => {
      handlerControls.listPrivateTokensRequests += 1;
      await maybeDelay();
      // METADATA ONLY: no digest and no plaintext ever appears in the list.
      return HttpResponse.json(validListPrivateTokensSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/organizations/:organizationId/private-tokens', async () => {
      handlerControls.createPrivateTokenRequests += 1;
      await maybeDelay();
      // One-time plaintext delivery: the response carries `tokenPlaintext` once
      // and is served with Cache-Control: no-store. The mock mirrors the real
      // contract shape (the plaintext is never stored client-side).
      return HttpResponse.json(validCreatePrivateTokenSamples[0] as JsonBodyType, {
        status: 200,
        headers: { 'cache-control': 'no-store' },
      });
    }),
    http.post(
      '/api/platform/v1/organizations/:organizationId/private-tokens/:tokenId/revoke',
      async ({ params }) => {
        handlerControls.revokePrivateTokenRequests += 1;
        await maybeDelay();
        return HttpResponse.json({ status: 'succeeded', tokenId: params.tokenId } as JsonBodyType, {
          status: 200,
        });
      },
    ),
    http.get('/api/platform/v1/organizations/:organizationId/audit', async () => {
      handlerControls.listSecurityAuditRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListSecurityAuditSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/organizations/:organizationId/trash', async () => {
      handlerControls.listTrashRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validListTrashSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post(
      '/api/platform/v1/organizations/:organizationId/trash/:projectId/restore',
      async () => {
        handlerControls.restoreProjectRequests += 1;
        await maybeDelay();
        return HttpResponse.json(validRestoreProjectSamples[0] as JsonBodyType, { status: 200 });
      },
    ),
    http.get('/api/platform/v1/auth/verify/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.email_verification as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/auth/reset/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.password_reset as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/auth/invitations/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.organization_invitation as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/account/deletion/intent/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.deletion_request as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/account/deletion/cancel/intent/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.deletion_cancel as JsonBodyType, {
        status: 200,
      });
    }),
    http.get('/api/platform/v1/account/deletion/preflight', async () => {
      handlerControls.deletionPreflightRequests += 1;
      await maybeDelay();
      const body =
        handlerControls.deletionPreflightStatus === 'blocked'
          ? DELETION_PREFLIGHT_BLOCKED
          : DELETION_PREFLIGHT_READY;
      return HttpResponse.json(body as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/account/deletion/request', async () => {
      handlerControls.requestAccountDeletionRequests += 1;
      // Sending the confirmation email does not terminate the session; the user
      // returns from the email with the deletion_request intent cookie still on
      // the same browser to submit the delete command.
      await maybeDelay();
      return HttpResponse.json(REQUEST_ACCOUNT_DELETION_SUCCESS as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/account/deletion', async () => {
      handlerControls.deleteAccountRequests += 1;
      // Accepting deletion terminates every session; the user must re-login and
      // can only cancel through the emailed cancel link.
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(DELETE_ACCOUNT_SUCCESS as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/account/deletion/cancel', async () => {
      handlerControls.cancelDeletionRequests += 1;
      // Cancellation revokes every session; the account is active again but the
      // user must re-login.
      persistSessionAuthenticated(false);
      await maybeDelay();
      return HttpResponse.json(CANCEL_DELETION_SUCCESS as JsonBodyType, { status: 200 });
    }),
    http.post('/__mock/scope', async ({ request }) => {
      const body = (await request.json()) as MockScope;
      setMockScope(
        body.type === 'workspace'
          ? { type: 'workspace' }
          : { type: body.type, id: body.id ?? 'prj_test_1' },
      );
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/__mock/session', async ({ request }) => {
      const body = (await request.json()) as { authenticated?: boolean };
      persistSessionAuthenticated(body.authenticated ?? true);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/__mock/deletion-preflight', async ({ request }) => {
      const body = (await request.json()) as { status?: 'ready' | 'blocked' };
      persistDeletionPreflight(body.status === 'blocked' ? 'blocked' : 'ready');
      return new HttpResponse(null, { status: 204 });
    }),
  ];
}
