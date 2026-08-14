import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { defineComponent } from 'vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/App.vue';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { handlerControls, setMockScope } from '../../src/mocks/handlers';
import { useNavigationStore } from '../../src/stores/navigation';
import { useSessionStore } from '../../src/stores/session';
import { mockServer } from '../msw/server';

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: { visible: Boolean, header: String, position: String, ariaLabel: String },
  emits: ['update:visible'],
  template:
    '<div data-testid="drawer" v-if="visible" :aria-label="ariaLabel"><h2>{{ header }}</h2><slot /></div>',
});

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
  await router.push('/organizations/org_test_1/projects/prj_test_1/overview');
  await router.isReady();
});
afterEach(() => {
  cleanup();
  mockServer.resetHandlers();
});
afterAll(() => {
  mockServer.close();
});

describe('responsive shell + keyboard foundation', () => {
  it('renders every shell nav entry as a keyboard-reachable link', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '项目导航' });
    await screen.findByRole('link', { name: '接入' });
    for (const label of ['接入', '概览', '问题', '请求', '数据状态', '发布', '告警', '访问']) {
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('href')).not.toBeNull();
    }
  });

  it('integrates organization and project switchers into the context sidebar', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    const contextSidebar = await screen.findByRole('navigation', { name: '项目导航' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('button', { name: '组织：Acme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '项目：Web' })).toBeTruthy();
    expect(contextSidebar.contains(screen.getByRole('button', { name: '组织：Acme' }))).toBe(true);
  });

  it('opens the narrow-screen drawer with expanded global and contextual navigation', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '项目导航' });
    const trigger = screen.getByRole('button', { name: '导航' });
    await fireEvent.click(trigger);
    expect(screen.getByTestId('drawer')).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: '全局导航' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('navigation', { name: '项目导航' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('link', { name: '概览' }).length).toBeGreaterThanOrEqual(1);
  });
});
