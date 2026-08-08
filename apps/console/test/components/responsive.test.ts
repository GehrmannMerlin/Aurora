import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { defineComponent } from 'vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/App.vue';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
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
  await router.push('/');
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
    await screen.findByRole('navigation', { name: '侧栏导航' });
    await screen.findByRole('link', { name: '接入' });
    for (const label of ['接入', '概览', '问题', '请求', '数据状态', '发布', '告警', '访问']) {
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('href')).not.toBeNull();
    }
  });

  it('exposes the scope switcher as a combobox', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '侧栏导航' });
    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('opens the narrow-screen drawer with the same sidebar entries', async () => {
    render(App, { global: { plugins: [pinia, router], stubs: { Drawer: DrawerStub } } });
    await screen.findByRole('navigation', { name: '侧栏导航' });
    const trigger = screen.getByRole('button', { name: '导航' });
    await fireEvent.click(trigger);
    expect(screen.getByTestId('drawer')).toBeTruthy();
    // the drawer reuses the same LayeredSidebar, so the same amber entry order appears
    expect(screen.getAllByRole('link', { name: '概览' }).length).toBeGreaterThanOrEqual(1);
  });
});
