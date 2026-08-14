import { cleanup, fireEvent, render, screen } from '@testing-library/vue';
import { RouterLinkStub } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppButton from '../../src/components/aurora/AppButton.vue';
import AppLink from '../../src/components/aurora/AppLink.vue';
import AppPageHeader from '../../src/components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../src/components/aurora/AppStatusBadge.vue';
import AppDrawer from '../../src/components/aurora/AppDrawer.vue';
import AppEmptyState from '../../src/components/aurora/AppEmptyState.vue';
import AppSection from '../../src/components/aurora/AppSection.vue';
import AppSkeleton from '../../src/components/aurora/AppSkeleton.vue';
import AppTechnicalDetails from '../../src/components/aurora/AppTechnicalDetails.vue';

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: { visible: Boolean, header: String, position: String, ariaLabel: String },
  emits: ['update:visible'],
  template:
    '<div data-testid="drawer" v-if="visible" :aria-label="ariaLabel"><h2>{{ header }}</h2><slot /></div>',
});

afterEach(() => {
  cleanup();
});

describe('Aurora UI wrapper layer', () => {
  it('AppButton renders an accessible button and emits click', async () => {
    const onClick = vi.fn();
    render(AppButton, { props: { onClick }, slots: { default: '重试' } });
    const button = screen.getByRole('button', { name: '重试' });
    await fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('AppButton disabled blocks click', async () => {
    const onClick = vi.fn();
    render(AppButton, {
      props: { disabled: true, onClick },
      slots: { default: '保存' },
    });
    await fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('AppLink renders a real anchor and marks active state', () => {
    render(AppLink, {
      props: { to: '/workspace', label: '工作空间', active: true },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    const link = screen.getByRole('link', { name: '工作空间' });
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('AppStatusBadge is a status with text, not color-only', () => {
    render(AppStatusBadge, {
      props: { tone: 'danger' },
      slots: { default: '异常' },
    });
    const badge = screen.getByRole('status');
    expect(badge.textContent).toContain('异常');
  });

  it('AppPageHeader renders the focusable page title', () => {
    render(AppPageHeader, { props: { title: '项目概览' } });
    const heading = screen.getByRole('heading', { name: '项目概览', level: 1 });
    expect(heading.id).toBe('page-title');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('AppPageHeader renders optional contextual content around its stable title target', () => {
    render(AppPageHeader, {
      props: { title: '项目概览', eyebrow: '项目', description: '查看真实状态' },
      slots: { actions: '刷新', meta: '数据截至 UTC' },
    });
    expect(screen.getByText('项目')).toBeTruthy();
    expect(screen.getByText('查看真实状态')).toBeTruthy();
    expect(screen.getByText('刷新')).toBeTruthy();
    expect(screen.getByText('数据截至 UTC')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('page-title');
  });

  it('AppStatusBadge exposes an optional icon alongside readable status text', () => {
    render(AppStatusBadge, {
      props: { tone: 'info' },
      slots: { icon: '<span aria-hidden="true">i</span>', default: '正在处理' },
    });
    expect(screen.getByRole('status').textContent).toContain('正在处理');
  });

  it('AppSection provides a titled evidence region and actions slot', () => {
    render(AppSection, {
      props: { title: '数据状态', description: '服务端权威结果', testId: 'data-status' },
      slots: { actions: '刷新', default: '证据内容' },
    });
    expect(screen.getByTestId('data-status')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: '数据状态' })).toBeTruthy();
    expect(screen.getByText('刷新')).toBeTruthy();
  });

  it('AppEmptyState explains an empty result without fake evidence', () => {
    render(AppEmptyState, {
      props: { title: '暂无事件', description: '当前项目还没有已接收事件' },
    });
    expect(screen.getByRole('status').textContent).toContain('当前项目还没有已接收事件');
  });

  it('AppSkeleton announces visible loading copy', () => {
    render(AppSkeleton, { props: { lines: 2 } });
    expect(screen.getByRole('status').textContent).toContain('正在加载…');
  });

  it('AppTechnicalDetails keeps raw evidence behind a native disclosure', () => {
    render(AppTechnicalDetails, { slots: { default: 'request-id: req_123' } });
    expect(screen.getByText('技术详情')).toBeTruthy();
    expect(document.querySelector('details')).toBeTruthy();
  });

  it('AppDrawer renders content only while open', async () => {
    const drawer = render(AppDrawer, {
      props: { open: true, title: '导航' },
      slots: { default: '侧栏内容' },
      global: { stubs: { Drawer: DrawerStub } },
    });
    expect(screen.getByTestId('drawer')).toBeTruthy();
    expect(screen.getByText('侧栏内容')).toBeTruthy();
    await drawer.rerender({ open: false });
    expect(screen.queryByTestId('drawer')).toBeNull();
  });
});
