import { http, HttpResponse, type JsonBodyType } from 'msw';
import {
  validAcceptInvitationSamples,
  validChangePasswordSamples,
  validConfirmEmailVerificationSamples,
  validConfirmPasswordResetSamples,
  validListProjectsSamples,
  validLoginSamples,
  validLogoutSamples,
  validNavigationSamples,
  validRegisterSamples,
  validRequestPasswordResetSamples,
  validSessionSamples,
} from '@aurora/platform-contract/contract-testkit';

export interface MockScope {
  readonly type: 'workspace' | 'organization' | 'project';
  readonly id?: string;
}

const MOCK_SCOPE_STORAGE_KEY = '__aurora_mock_scope';
const MOCK_SESSION_STORAGE_KEY = '__aurora_mock_session_authenticated';

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
  /** Toggle for the session projection: true = authenticated, false = 401. */
  sessionAuthenticated: readStoredSessionAuthenticated(),
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
  email_verification: { status: 'valid', csrf: 'csrf_intent_token', maskedEmail: 'us**@example.invalid' },
  password_reset: { status: 'valid', csrf: 'csrf_intent_token' },
  organization_invitation: {
    status: 'valid',
    csrf: 'csrf_intent_token',
    maskedEmail: 'us**@example.invalid',
    organizationName: 'Acme',
    role: 'member',
  },
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
      return HttpResponse.json(validConfirmEmailVerificationSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/password/request', async () => {
      handlerControls.requestPasswordResetRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validRequestPasswordResetSamples[0] as JsonBodyType, { status: 200 });
    }),
    http.post('/api/platform/v1/auth/password/confirm', async () => {
      handlerControls.confirmPasswordResetRequests += 1;
      await maybeDelay();
      return HttpResponse.json(validConfirmPasswordResetSamples[0] as JsonBodyType, { status: 200 });
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
    http.get('/api/platform/v1/auth/verify/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.email_verification as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/auth/reset/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.password_reset as JsonBodyType, { status: 200 });
    }),
    http.get('/api/platform/v1/auth/invitations/:token', async () => {
      handlerControls.intentLinkRequests += 1;
      await maybeDelay();
      return HttpResponse.json(INTENT_LINK_RESPONSES.organization_invitation as JsonBodyType, { status: 200 });
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
  ];
}
