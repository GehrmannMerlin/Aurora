import { cleanup, render, screen, within } from '@testing-library/vue';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/App.vue';
import { router } from '../../src/router';
import { pinia } from '../../src/stores';
import { mockServer } from '../msw/server';

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

describe('app shell', () => {
  it('renders the top bar entries when authenticated (real session projection)', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    const topnav = await screen.findByRole('navigation', { name: '顶栏导航' });
    expect(within(topnav).getByRole('link', { name: '工作空间' })).toBeTruthy();
    expect(within(topnav).getByRole('link', { name: '通知' })).toBeTruthy();
    expect(within(topnav).getByRole('link', { name: '账号安全' })).toBeTruthy();
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
