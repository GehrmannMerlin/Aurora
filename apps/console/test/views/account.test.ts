import { http, HttpResponse, type JsonBodyType } from 'msw';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestCache } from '../../src/api/cache';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { useSessionStore } from '../../src/stores/session';
import { handlerControls } from '../../src/mocks/handlers';
import { mockServer } from '../msw/server';
import AccountSecurityView from '../../src/views/account/AccountSecurityView.vue';
import DeletionCancelView from '../../src/views/account/DeletionCancelView.vue';
import DeletionConfirmView from '../../src/views/account/DeletionConfirmView.vue';

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  requestCache.clear();
  handlerControls.sessionAuthenticated = false;
  handlerControls.deletionPreflightStatus = 'ready';
  handlerControls.deletionPreflightRequests = 0;
  handlerControls.requestAccountDeletionRequests = 0;
  handlerControls.deleteAccountRequests = 0;
  handlerControls.cancelDeletionRequests = 0;
  handlerControls.intentLinkRequests = 0;
  useSessionStore(pinia).reset();
});

afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
  vi.restoreAllMocks();
});

afterAll(() => {
  mockServer.close();
});

describe('AccountSecurityView deletion danger zone', () => {
  async function renderSecurity(): Promise<void> {
    handlerControls.sessionAuthenticated = true;
    await useSessionStore(pinia).restore();
    await router.push('/account/security');
    await router.isReady();
    render(AccountSecurityView, { global: { plugins: [pinia, router] } });
  }

  it('reaches the ready danger confirmation through the two-step flow', async () => {
    await renderSecurity();
    // The initial projection is loading, then the ready request-email button
    // appears (the final delete submit is NOT shown before the email is sent).
    expect(screen.getByTestId('deletion-preflight-loading')).toBeTruthy();
    expect(await screen.findByTestId('request-deletion-email-button')).toBeTruthy();
    expect(handlerControls.deletionPreflightRequests).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('delete-account-button')).toBeNull();

    // Step one: sending the confirmation email reveals the masked recipient and
    // the final delete submit.
    await fireEvent.click(screen.getByTestId('request-deletion-email-button'));
    await waitFor(() => {
      expect(handlerControls.requestAccountDeletionRequests).toBeGreaterThanOrEqual(1);
    });
    expect(await screen.findByTestId('deletion-email-sent')).toBeTruthy();
    expect(screen.getByTestId('deletion-email-sent').textContent).toContain('us**@example.invalid');
    expect(await screen.findByTestId('delete-account-button')).toBeTruthy();
  });

  it('uses an account work area with separate password, session and danger sections', async () => {
    await renderSecurity();

    expect(screen.getByRole('heading', { name: '账号安全' })).toBeTruthy();
    expect(screen.getByTestId('account-security-password-section')).toBeTruthy();
    expect(screen.getByTestId('account-security-session-section')).toBeTruthy();
    expect(screen.getByTestId('deletion-section')).toBeTruthy();
    expect(screen.queryByTestId('auth-card')).toBeNull();
  });

  it('shows the blocking org list with a transfer link, no submit, and rechecks', async () => {
    handlerControls.deletionPreflightStatus = 'blocked';
    await renderSecurity();
    expect(await screen.findByTestId('deletion-org-block-list')).toBeTruthy();
    expect(screen.getByTestId('deletion-org-name').textContent).toBe('Acme');
    expect(screen.getByTestId('deletion-org-kind').textContent).toBe('组织');
    // Blocked state must NOT present the final delete submit.
    expect(screen.queryByTestId('delete-account-button')).toBeNull();
    // Re-check re-reads the authoritative preflight.
    const before = handlerControls.deletionPreflightRequests;
    await fireEvent.click(screen.getByTestId('deletion-recheck-button'));
    await waitFor(() => {
      expect(handlerControls.deletionPreflightRequests).toBeGreaterThan(before);
    });
    expect(await screen.findByTestId('deletion-org-block-list')).toBeTruthy();
  });

  it('submits identityDeleteAccount and redirects to login on acceptance', async () => {
    await renderSecurity();
    await screen.findByTestId('request-deletion-email-button');
    await fireEvent.click(screen.getByTestId('request-deletion-email-button'));
    await screen.findByTestId('delete-account-button');
    await fireEvent.update(
      screen.getByLabelText('当前密码', { selector: '#deletion-current-password' }),
      's3cure-Password!',
    );
    await fireEvent.click(screen.getByTestId('delete-account-button'));
    await waitFor(() => {
      expect(handlerControls.deleteAccountRequests).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('auth.login');
    });
    // The revoked_all acceptance cleared client session state.
    expect(useSessionStore().status).not.toBe('authenticated');
  });

  it('surfaces the backend result when the mailbox confirmation is missing', async () => {
    // A real backend rejects the delete command (404 not_found) when the
    // deletion_request intent cookie is absent — the user must complete the
    // emailed confirmation first.
    mockServer.use(
      http.post('/api/platform/v1/account/deletion', () => {
        handlerControls.deleteAccountRequests += 1;
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Not found',
            status: 404,
            detail: 'The deletion confirmation was not found.',
            code: 'not_found',
            requestId: 'req_test_404',
          } as JsonBodyType,
          { status: 404 },
        );
      }),
    );
    await renderSecurity();
    await screen.findByTestId('request-deletion-email-button');
    await fireEvent.click(screen.getByTestId('request-deletion-email-button'));
    await screen.findByTestId('delete-account-button');
    await fireEvent.update(
      screen.getByLabelText('当前密码', { selector: '#deletion-current-password' }),
      's3cure-Password!',
    );
    await fireEvent.click(screen.getByTestId('delete-account-button'));
    await waitFor(() => {
      expect(handlerControls.deleteAccountRequests).toBeGreaterThanOrEqual(1);
    });
    expect(await screen.findByTestId('deletion-error')).toBeTruthy();
    expect(screen.getByTestId('deletion-error').textContent).toContain(
      '请先打开邮箱中的注销确认邮件',
    );
    // The ready form stays available for a retry after the confirmation.
    expect(screen.queryByTestId('delete-account-button')).toBeTruthy();
  });
});

describe('DeletionCancelView', () => {
  it('reads the cancel link, clears the token and cancels the deletion', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await router.push({ path: '/account/deletion-cancel', query: { token: 'raw_token' } });
    await router.isReady();
    render(DeletionCancelView, { global: { plugins: [pinia, router] } });
    await waitFor(() => {
      expect(handlerControls.intentLinkRequests).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalled();
    });
    expect(window.location.search).not.toContain('raw_token');
    await fireEvent.update(screen.getByLabelText('当前密码'), 's3cure-Password!');
    await fireEvent.click(screen.getByRole('button', { name: '撤销注销' }));
    await waitFor(() => {
      expect(handlerControls.cancelDeletionRequests).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(router.currentRoute.value.name).toBe('auth.login');
    });
  });

  it('shows invalid-link when no token is present', async () => {
    await router.push('/account/deletion-cancel');
    await router.isReady();
    render(DeletionCancelView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByText(/撤销链接无效或已缺失/)).toBeTruthy();
  });
});

describe('DeletionConfirmView', () => {
  it('reads the deletion_request link, clears the token and confirms', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    await router.push({ path: '/account/deletion-confirm', query: { token: 'raw_token' } });
    await router.isReady();
    render(DeletionConfirmView, { global: { plugins: [pinia, router] } });
    await waitFor(() => {
      expect(handlerControls.intentLinkRequests).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      expect(replaceState).toHaveBeenCalled();
    });
    expect(window.location.search).not.toContain('raw_token');
    expect(await screen.findByText(/注销确认已完成/)).toBeTruthy();
    expect(screen.getByText(/前往账号安全页完成注销/)).toBeTruthy();
  });

  it('shows invalid-link when no token is present', async () => {
    await router.push('/account/deletion-confirm');
    await router.isReady();
    render(DeletionConfirmView, { global: { plugins: [pinia, router] } });
    expect(await screen.findByText(/注销确认链接无效或已缺失/)).toBeTruthy();
  });
});
