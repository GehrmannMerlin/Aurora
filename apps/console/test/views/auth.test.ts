import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue';
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
  handlerControls.registerRequests = 0;
  handlerControls.loginRequests = 0;
  handlerControls.logoutRequests = 0;
  handlerControls.confirmEmailRequests = 0;
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
});

describe('VerifyEmailView', () => {
  it('renders the masked email, verification status and disabled resend during cooldown', async () => {
    useAuthStore().setRegistration(REGISTRATION);
    await router.push('/verify-email');
    await router.isReady();
    render(VerifyEmailView, { global: { plugins: [pinia, router] } });
    expect(screen.getByText('us**@example.invalid')).toBeTruthy();
    expect(screen.getByTestId('verify-status').textContent).toContain('email_verification_pending');
    expect(screen.getByTestId('verify-server-time').textContent).toContain('2026-08-09T01:00:00.000Z');
    const resend = screen.getByTestId<HTMLButtonElement>('resend-button');
    expect(resend.disabled).toBe(true);
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
    expect(screen.getByTestId('reset-server-time').textContent).toContain('2026-08-09T01:00:00.000Z');
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
    await fireEvent.update(screen.getByLabelText('当前密码'), 'old-password');
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
