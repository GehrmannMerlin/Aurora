import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.vue';
import TopBar from '../../src/components/shell/TopBar.vue';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { handlerControls, setMockScope } from '../../src/mocks/handlers';
import { useNavigationStore } from '../../src/stores/navigation';
import { useSessionStore } from '../../src/stores/session';
import { mockServer } from '../msw/server';

beforeAll(() => {
  mockServer.listen({ onUnhandledRequest: 'error' });
});
beforeEach(async () => {
  handlerControls.sessionAuthenticated = true;
  setMockScope({ type: 'project', id: 'prj_test_1' });
  useSessionStore(pinia).reset();
  useNavigationStore(pinia).clear();
  await useSessionStore(pinia).restore();
  await useNavigationStore(pinia).load();
  await router.push('/');
  await router.isReady();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockServer.resetHandlers();
});
afterAll(() => {
  mockServer.close();
});

describe('app shell', () => {
  it('renders the top bar entries when authenticated (real session projection)', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    expect(await screen.findByRole('button', { name: '组织：Acme' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '工作空间' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('button', { name: '项目：Web' }).getAttribute('aria-current'),
    ).toBeNull();
    expect(screen.getByRole('link', { name: '通知' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '账号安全' })).toBeTruthy();
  });

  it('opens anchored scope menus and navigates with the authorized target', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    const organizationTrigger = await screen.findByRole('button', { name: '组织：Acme' });

    await fireEvent.click(organizationTrigger);
    const organizationMenu = screen.getByRole('menu', { name: '选择组织' });
    expect(organizationMenu).toBeTruthy();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Acme（当前）' }));
    await waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/workspace');
    });

    const projectTrigger = await screen.findByRole('button', { name: '项目：请选择' });
    await fireEvent.click(projectTrigger);
    expect(screen.getByRole('menu', { name: '选择项目' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Web' }));
    await waitFor(() => {
      expect(router.currentRoute.value.path).toBe(
        '/organizations/org_test_1/projects/prj_test_1/overview',
      );
    });
  });

  it('closes a scope menu with Escape or an outside pointer and restores trigger focus', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    const trigger = await screen.findByRole('button', { name: '组织：Acme' });

    trigger.focus();
    await fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: '选择组织' })).toBeTruthy();
    await fireEvent.keyDown(trigger, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: '选择组织' })).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);

    await fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: '选择组织' })).toBeTruthy();
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: '选择组织' })).toBeNull();
  });

  it('keeps the previous scope and shows a readable error when navigation fails', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    const navigation = useNavigationStore(pinia);
    const previousScope = navigation.currentScope;
    vi.spyOn(router, 'push').mockRejectedValueOnce(new Error('navigation failed'));

    await fireEvent.click(await screen.findByRole('button', { name: '组织：Acme' }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Acme（当前）' }));

    expect((await screen.findByRole('alert')).textContent).toContain('组织切换失败，请重试。');
    expect(navigation.currentScope).toEqual(previousScope);
  });

  it('keeps an empty organization menu operable with an explicit explanation', async () => {
    useNavigationStore(pinia).clear();
    render(TopBar, { global: { plugins: [pinia, router] } });

    await fireEvent.click(screen.getByRole('button', { name: '组织：暂无组织' }));
    expect(screen.getByRole('menu', { name: '选择组织' }).textContent).toContain(
      '当前账号没有可访问的组织。',
    );
  });

  it('renders the project sidebar entries in project scope', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    expect(await screen.findByRole('navigation', { name: '侧栏导航' })).toBeTruthy();
    for (const label of ['接入', '概览', '问题', '请求', '数据状态', '发布', '告警', '访问']) {
      expect(screen.getByRole('link', { name: label }), label).toBeTruthy();
    }
  });

  it('sets a stable page title after navigation', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    await router.push('/workspace');
    await router.isReady();
    expect(document.title).toContain('工作空间');
  });
});
