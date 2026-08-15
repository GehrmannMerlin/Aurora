import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { useAuthStore, type RegisterResult } from '../../src/stores/auth';
import { useSessionStore } from '../../src/stores/session';
import { handlerControls } from '../../src/mocks/handlers';
import { mockServer } from '../msw/server';
import LoginView from '../../src/views/auth/LoginView.vue';
import RegisterView from '../../src/views/auth/RegisterView.vue';
import VerifyEmailView from '../../src/views/auth/VerifyEmailView.vue';
import VerifyEmailConfirmView from '../../src/views/auth/VerifyEmailConfirmView.vue';
import ForgotPasswordView from '../../src/views/auth/ForgotPasswordView.vue';
import ResetPasswordView from '../../src/views/auth/ResetPasswordView.vue';
import InvitationAcceptView from '../../src/views/auth/InvitationAcceptView.vue';
import AccountSecurityView from '../../src/views/account/AccountSecurityView.vue';
import App from '../../src/App.vue';

const REGISTRATION: RegisterResult = {
  accountId: 'acct_test_1',
  workspaceId: { organizationId: 'org_test_1' },
  emailMasked: 'us**@example.invalid',
  verificationStatus: { verified: false, reason: 'email_verification_pending' },
  resendAvailableAt: '2026-08-09T01:05:00.000Z',
  serverTime: '2026-08-09T01:00:00.000Z',
};

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});

beforeEach(async () => {
  await router.push('/login');
  await router.isReady();
  useSessionStore().reset();
  useAuthStore().clear();
  handlerControls.sessionAuthenticated = false;
  handlerControls.sessionVerified = true;
  handlerControls.sessionRequests = 0;
  handlerControls.delayMs = 0;
  handlerControls.registerRequests = 0;
  handlerControls.loginRequests = 0;
  handlerControls.logoutRequests = 0;
  handlerControls.confirmEmailRequests = 0;
  handlerControls.resendEmailVerificationRequests = 0;
  handlerControls.requestPasswordResetRequests = 0;
  handlerControls.confirmPasswordResetRequests = 0;
  handlerControls.changePasswordRequests = 0;
  handlerControls.acceptInvitationRequests = 0;
  handlerControls.intentLinkRequests = 0;
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => {
  mockServer.close();
});

describe('RegisterView', () => {
  it('submits identityRegister and navigates to verify-email with the handoff', async () => {
    await router.push('/register');
    await router.isReady();
    render(RegisterView, { global: { plugins: [pinia, router] } });
    await fireEvent.update(screen.getByLabelText('邮箱'), 'user@example.invalid');
    await fireEvent.update(screen.getByLabelText('密码'), 's3cure-Passw0rd!');
    await fireEvent.click(screen.getByRole('button', { name: '注册' }));
    await waitFor(() => {
      expect(handlerControls.registerRequests).toBe(1);
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('auth.verify-email');
    });
    expect(useAuthStore().registration?.emailMasked).toBe('us**@example.invalid');
  });

  it('shows the real email/password rules as hints before any input', async () => {
    await router.push('/register');
    await router.isReady();
    render(RegisterView, { global: { plugins: [pinia, router] } });
    // Hints must come from the shared contract schema (email 3–320, password 8–256),
    // never an invented composition rule.
    expect(screen.getByText(/邮箱地址/)).toBeTruthy();
    expect(screen.getByText('请输入 3–320 个字符的邮箱地址。')).toBeTruthy();
    expect(screen.getByText('密码需为 8–256 个字符。')).toBeTruthy();
  });

  it('maps an invalid email to the email field, not the generic banner', async () => {
    await router.push('/register');
    await router.isReady();
    render(RegisterView, { global: { plugins: [pinia, router] } });
    await fireEvent.update(screen.getByLabelText('邮箱'), 'a');
    await fireEvent.update(screen.getByLabelText('密码'), 'valid-1234');
    await fireEvent.click(screen.getByRole('button', { name: '注册' }));
    // The validation failure is attached to the email field and blocks the submit.
    expect(screen.getByText('请输入 3–320 个字符的邮箱地址。')).toBeTruthy();
    expect(handlerControls.registerRequests).toBe(0);
    // The page-level generic banner is NOT the only feedback path.
    expect(screen.queryByText('输入内容不符合要求，请检查后重试。')).toBeNull();
  });

  it('maps an invalid password to the password field with the real rule', async () => {
    await router.push('/register');
    await router.isReady();
    render(RegisterView, { global: { plugins: [pinia, router] } });
    await fireEvent.update(screen.getByLabelText('邮箱'), 'user@example.invalid');
    await fireEvent.update(screen.getByLabelText('密码'), 'short');
    await fireEvent.click(screen.getByRole('button', { name: '注册' }));
    // The real password rule (8–256 chars) is shown next to the password field.
    expect(screen.getByText('密码需为 8–256 个字符。')).toBeTruthy();
    expect(handlerControls.registerRequests).toBe(0);
    expect(screen.queryByText('输入内容不符合要求，请检查后重试。')).toBeNull();
  });
});

describe('VerifyEmailView', () => {
  const pendingSession = {
    account: {
      accountId: 'acct_history_1',
      email: 'history@tests.invalid',
      emailMasked: 'h***@tests.invalid',
      verified: false,
    },
    authentication: 'pending_verification',
    session: { expiresAt: '2026-08-15T01:00:00.000Z' },
    emailVerification: {
      serverTime: '2026-08-14T00:01:00.000Z',
      resendAvailableAt: '2026-08-14T00:01:00.000Z',
    },
    csrf: 'csrf_history_test',
    navigation: [],
  };

  function usePendingSession(): void {
    handlerControls.sessionAuthenticated = true;
    mockServer.use(
      http.get('/api/platform/v1/session', async () => {
        handlerControls.sessionRequests += 1;
        if (handlerControls.delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, handlerControls.delayMs));
        }
        return HttpResponse.json(pendingSession as JsonBodyType);
      }),
    );
  }

  async function renderVerifyEmail(): Promise<void> {
    await router.push('/verify-email');
    await router.isReady();
    render(VerifyEmailView, { global: { plugins: [pinia, router] } });
  }

  it('renders loading before the forced Session restoration completes', async () => {
    usePendingSession();
    handlerControls.delayMs = 50;
    await renderVerifyEmail();
    expect(screen.getByText(/正在恢复验证状态/)).toBeTruthy();
    await screen.findByText('h***@tests.invalid');
    handlerControls.delayMs = 0;
  });

  it('restores a historical pending account without registration memory and exposes no email input', async () => {
    usePendingSession();
    await renderVerifyEmail();
    expect(await screen.findByText('h***@tests.invalid')).toBeTruthy();
    expect(useAuthStore().registration).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('resend-button').disabled).toBe(false);
  });

  it('restores the authoritative cooldown from Session without registration memory', async () => {
    const serverTime = new Date();
    const resendAvailableAt = new Date(serverTime.getTime() + 60_000);
    handlerControls.sessionAuthenticated = true;
    mockServer.use(
      http.get('/api/platform/v1/session', () =>
        HttpResponse.json({
          ...pendingSession,
          emailVerification: {
            serverTime: serverTime.toISOString(),
            resendAvailableAt: resendAvailableAt.toISOString(),
          },
        } as JsonBodyType),
      ),
    );
    await renderVerifyEmail();
    expect(await screen.findByText('h***@tests.invalid')).toBeTruthy();
    expect(useAuthStore().registration).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('resend-button').disabled).toBe(true);
    });
    expect(screen.getByTestId('resend-button').textContent).toContain('60 秒');
  });

  it('renders the registration cooldown using an absolute server-time countdown', async () => {
    useAuthStore().setRegistration(REGISTRATION);
    handlerControls.sessionAuthenticated = true;
    mockServer.use(
      http.get('/api/platform/v1/session', () =>
        HttpResponse.json({
          ...pendingSession,
          emailVerification: {
            serverTime: REGISTRATION.serverTime,
            resendAvailableAt: REGISTRATION.resendAvailableAt,
          },
        } as JsonBodyType),
      ),
    );
    await renderVerifyEmail();
    expect(await screen.findByText('h***@tests.invalid')).toBeTruthy();
    expect(screen.getByTestId('verify-status').textContent).toContain('等待邮箱验证');
    expect(screen.getByText(/验证状态键: email_verification_pending/)).toBeTruthy();
    expect(screen.getByTestId('verify-server-time').textContent).toContain('2026-08-09 01:00 UTC');
    const resend = screen.getByTestId<HTMLButtonElement>('resend-button');
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toContain('300 秒');
  });

  it('queues a resend command, prevents duplicate in-flight submission, and focuses its result', async () => {
    usePendingSession();
    let resolveResend: (() => void) | undefined;
    mockServer.use(
      http.post('/api/platform/v1/auth/email/resend', async () => {
        handlerControls.resendEmailVerificationRequests += 1;
        await new Promise<void>((resolve) => {
          resolveResend = resolve;
        });
        return HttpResponse.json({
          emailMasked: 'h***@tests.invalid',
          deliveryStatus: 'queued',
          resendAvailableAt: '2026-08-14T01:01:00.000Z',
          serverTime: '2026-08-14T01:00:00.000Z',
        } as JsonBodyType);
      }),
    );
    await renderVerifyEmail();
    const resend = await screen.findByTestId<HTMLButtonElement>('resend-button');
    await fireEvent.click(resend);
    expect(resend.disabled).toBe(true);
    await fireEvent.click(resend);
    expect(handlerControls.resendEmailVerificationRequests).toBe(1);
    resolveResend?.();
    const result = await screen.findByText(/新的验证邮件已加入发送队列/);
    expect(result.closest('[tabindex="-1"]')).toBe(document.activeElement);
    expect(resend.textContent).toContain('60 秒');
  });

  it('shows the rolling 24-hour limit from a 429 response', async () => {
    usePendingSession();
    mockServer.use(
      http.post('/api/platform/v1/auth/email/resend', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Resend limit reached',
            status: 429,
            detail: 'Try again later.',
            code: 'rate_limited',
            requestId: 'req_rate_limit_test',
            retryAfter: 3600,
            resendAvailableAt: '2026-08-14T02:00:00.000Z',
          } as JsonBodyType,
          { status: 429 },
        ),
      ),
    );
    await renderVerifyEmail();
    await fireEvent.click(await screen.findByTestId('resend-button'));
    expect(await screen.findByText(/24 小时内的重新发送次数已达上限/)).toBeTruthy();
  });

  it('refreshes Session and shows verified when resend reports a state conflict', async () => {
    usePendingSession();
    let sessionReads = 0;
    mockServer.use(
      http.get('/api/platform/v1/session', () => {
        sessionReads += 1;
        return HttpResponse.json(
          sessionReads <= 2
            ? (pendingSession as JsonBodyType)
            : ({
                ...pendingSession,
                account: { ...pendingSession.account, verified: true },
                authentication: 'authenticated',
              } as JsonBodyType),
        );
      }),
      http.post('/api/platform/v1/auth/email/resend', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Email already verified',
            status: 409,
            detail: 'The account is already active.',
            code: 'state_machine_conflict',
            requestId: 'req_verified_test',
          } as JsonBodyType,
          { status: 409 },
        ),
      ),
    );
    handlerControls.sessionAuthenticated = true;
    await renderVerifyEmail();
    await fireEvent.click(await screen.findByTestId('resend-button'));
    expect(await screen.findByText(/当前账号邮箱已验证/)).toBeTruthy();
    expect(sessionReads).toBe(3);
  });

  it('shows verified from authoritative Session state', async () => {
    handlerControls.sessionAuthenticated = true;
    await renderVerifyEmail();
    expect(await screen.findByText(/当前账号邮箱已验证/)).toBeTruthy();
    expect(screen.queryByTestId('resend-button')).toBeNull();
  });

  it('shows a login recovery action when the Session expired', async () => {
    handlerControls.sessionAuthenticated = false;
    await renderVerifyEmail();
    expect(await screen.findByText(/未找到可用的注册交接或登录会话/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回登录' })).toBeTruthy();
  });

  it('shows a retryable provider-unavailable result', async () => {
    usePendingSession();
    mockServer.use(
      http.post('/api/platform/v1/auth/email/resend', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Email provider unavailable',
            status: 503,
            detail: 'Retry later.',
            code: 'authority_unavailable',
            requestId: 'req_provider_test',
          } as JsonBodyType,
          { status: 503 },
        ),
      ),
    );
    await renderVerifyEmail();
    await fireEvent.click(await screen.findByTestId('resend-button'));
    expect(await screen.findByText(/邮件服务暂时不可用/)).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>('resend-button').disabled).toBe(false);
  });

  it('uses the authenticated session as the recovery path when registration handoff is lost', async () => {
    handlerControls.sessionAuthenticated = true;
    await useSessionStore().restore();
    await router.push('/verify-email');
    await router.isReady();
    render(VerifyEmailView, { global: { plugins: [pinia, router] } });
    expect(screen.getByText(/当前账号邮箱已验证/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '继续工作空间' })).toBeTruthy();
    expect(screen.queryByText('未找到注册信息。')).toBeNull();
  });

  it('offers login and registration when neither session nor handoff exists', async () => {
    await router.push('/verify-email');
    await router.isReady();
    render(VerifyEmailView, { global: { plugins: [pinia, router] } });
    expect(screen.getByRole('link', { name: '返回登录' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '重新注册' })).toBeTruthy();
  });
});

describe('VerifyEmailConfirmView', () => {
  it('reads the intent link, clears the raw token and confirms the email', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await router.push({ path: '/verify-email/confirm', query: { token: 'raw_token' } });
    await router.isReady();
    render(VerifyEmailConfirmView, { global: { plugins: [pinia, router] } });
    await waitFor(() => {
      expect(handlerControls.intentLinkRequests).toBe(1);
    });
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalled();
    });
    expect(window.location.search).not.toContain('raw_token');
    await fireEvent.click(screen.getByTestId('confirm-email-button'));
    await waitFor(() => {
      expect(handlerControls.confirmEmailRequests).toBe(1);
    });
    expect(screen.getByText(/邮箱已验证/)).toBeTruthy();
  });

  it('shows invalid-link when no token is present', async () => {
    await router.push('/verify-email/confirm');
    await router.isReady();
    render(VerifyEmailConfirmView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByText(/验证链接无效或已缺失/)).toBeTruthy();
  });
});

describe('LoginView', () => {
  it('keeps login inside the public Calm Observability authentication shell', async () => {
    await router.push('/login');
    await router.isReady();
    render(App, { global: { plugins: [pinia, router] } });

    expect(await screen.findByTestId('auth-shell')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByText('把异常、请求与性能证据放回同一个调查上下文')).toBeTruthy();
    expect(screen.getByLabelText('邮箱')).toBeTruthy();
    expect(screen.getByLabelText('密码')).toBeTruthy();
    await fireEvent.update(screen.getByLabelText('邮箱'), 'user@example.invalid');
    await fireEvent.update(screen.getByLabelText('密码'), 's3cure-Passw0rd!');
    await fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(handlerControls.loginRequests).toBe(1);
    });
  });

  it('submits identityLogin, applies the session and navigates to the workspace', async () => {
    await router.push('/login');
    await router.isReady();
    render(LoginView, { global: { plugins: [pinia, router] } });
    await fireEvent.update(screen.getByLabelText('邮箱'), 'user@example.invalid');
    await fireEvent.update(screen.getByLabelText('密码'), 's3cure-Passw0rd!');
    await fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => {
      expect(handlerControls.loginRequests).toBe(1);
    });
    await waitFor(() => {
      expect(useSessionStore().status).toBe('authenticated');
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('workspace.home');
    });
  });
});

describe('ForgotPasswordView', () => {
  it('submits identityRequestPasswordReset and shows the uniform result', async () => {
    await router.push('/forgot-password');
    await router.isReady();
    render(ForgotPasswordView, { global: { plugins: [pinia, router] } });
    await fireEvent.update(screen.getByLabelText('邮箱'), 'user@example.invalid');
    await fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }));
    await waitFor(() => {
      expect(handlerControls.requestPasswordResetRequests).toBe(1);
    });
    expect(screen.getByText(/如果该邮箱已注册/)).toBeTruthy();
    expect(screen.getByTestId('reset-server-time').textContent).toContain(
      '2026-08-09T01:00:00.000Z',
    );
  });
});

describe('ResetPasswordView', () => {
  it('reads the reset link, clears the token and confirms the reset', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await router.push({ path: '/reset-password', query: { token: 'raw_token' } });
    await router.isReady();
    render(ResetPasswordView, { global: { plugins: [pinia, router] } });
    await waitFor(() => {
      expect(handlerControls.intentLinkRequests).toBe(1);
    });
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalled();
    });
    expect(window.location.search).not.toContain('raw_token');
    await fireEvent.update(screen.getByLabelText('新密码'), 's3cure-New-Password!');
    await fireEvent.click(screen.getByRole('button', { name: '设置新密码' }));
    await waitFor(() => {
      expect(handlerControls.confirmPasswordResetRequests).toBe(1);
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('auth.login');
    });
  });
});

describe('InvitationAcceptView', () => {
  it('reads the invitation link, shows the summary and accepts with CSRF', async () => {
    handlerControls.sessionAuthenticated = true;
    const session = useSessionStore();
    await session.restore();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await router.push({ path: '/invitations/accept', query: { token: 'raw_token' } });
    await router.isReady();
    render(InvitationAcceptView, { global: { plugins: [pinia, router] } });
    await waitFor(() => {
      expect(handlerControls.intentLinkRequests).toBe(1);
    });
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalled();
    });
    expect(screen.getByTestId('invite-org').textContent).toContain('Acme');
    expect(screen.getByTestId('invite-role').textContent).toContain('成员');
    await fireEvent.click(screen.getByTestId('accept-invitation-button'));
    await waitFor(() => {
      expect(handlerControls.acceptInvitationRequests).toBe(1);
    });
    expect(screen.getByText(/你已加入/)).toBeTruthy();
  });
});

describe('AccountSecurityView', () => {
  async function renderAuthenticated(): Promise<void> {
    handlerControls.sessionAuthenticated = true;
    const session = useSessionStore();
    await session.restore();
    await router.push('/account/security');
    await router.isReady();
    render(AccountSecurityView, { global: { plugins: [pinia, router] } });
  }

  it('submits identityChangePassword and redirects to login on revoked_all', async () => {
    await renderAuthenticated();
    await fireEvent.update(
      screen.getByLabelText('当前密码', { selector: '#security-current-password' }),
      'old-password',
    );
    await fireEvent.update(screen.getByLabelText('新密码'), 's3cure-New-Password!');
    await fireEvent.click(screen.getByTestId('change-password-button'));
    await waitFor(() => {
      expect(handlerControls.changePasswordRequests).toBe(1);
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('auth.login');
    });
    // The revoked_all response cleared client state; the guard's re-restore sees
    // no session (the MSW store reflects the revocation).
    expect(useSessionStore().status).not.toBe('authenticated');
  });

  it('submits identityLogout and redirects to login', async () => {
    await renderAuthenticated();
    await fireEvent.click(screen.getByTestId('logout-button'));
    await waitFor(() => {
      expect(handlerControls.logoutRequests).toBe(1);
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('auth.login');
    });
  });
});
