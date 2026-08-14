import { cleanup, render, screen } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import AuthUnavailableView from '../../src/components/pages/AuthUnavailableView.vue';
import ForbiddenView from '../../src/components/pages/ForbiddenView.vue';
import RootView from '../../src/components/pages/RootView.vue';
import RouteErrorView from '../../src/components/pages/RouteErrorView.vue';
import UnavailableView from '../../src/components/pages/UnavailableView.vue';
import { useSessionStore } from '../../src/stores/session';

afterEach(() => {
  cleanup();
});

describe('status pages', () => {
  it('RouteErrorView offers a retry action', () => {
    render(RouteErrorView, {
      global: {
        mocks: { $router: { go: () => undefined } },
      },
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByTestId('route-error-view').querySelector('.au-empty-state')).toBeTruthy();
  });

  it('ForbiddenView reveals no existence', () => {
    render(ForbiddenView);
    expect(screen.getByText('无权限访问')).toBeTruthy();
    expect(screen.getByText(/不会透露目标是否存在/)).toBeTruthy();
    expect(screen.getByTestId('forbidden-view').querySelector('.au-empty-state')).toBeTruthy();
  });

  it('AuthUnavailableView never fakes login', () => {
    render(AuthUnavailableView);
    expect(screen.getByText(/功能未提供/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /登录/i })).toBeNull();
    expect(screen.getByTestId('auth-unavailable-view').querySelector('.au-empty-state')).toBeTruthy();
  });

  it('UnavailableView renders each approved reason with text', () => {
    render(UnavailableView, {
      props: { title: '问题列表', reason: 'capability-not-provided' },
    });
    expect(screen.getByText('功能未提供')).toBeTruthy();
  });

  it('RootView shows authentication-unavailable when session is unavailable', () => {
    setActivePinia(createPinia());
    const session = useSessionStore();
    session.status = 'unavailable';
    render(RootView);
    expect(screen.getByText(/认证能力未提供/)).toBeTruthy();
  });
});
