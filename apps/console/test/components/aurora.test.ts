import { fireEvent, render, screen } from '@testing-library/vue';
import { RouterLinkStub } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import AppButton from '../../src/components/aurora/AppButton.vue';
import AppLink from '../../src/components/aurora/AppLink.vue';
import AppPageHeader from '../../src/components/aurora/AppPageHeader.vue';
import AppStatusBadge from '../../src/components/aurora/AppStatusBadge.vue';
import AppDrawer from '../../src/components/aurora/AppDrawer.vue';

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: { visible: Boolean, header: String, position: String, ariaLabel: String },
  emits: ['update:visible'],
  template:
    '<div data-testid="drawer" v-if="visible" :aria-label="ariaLabel"><h2>{{ header }}</h2><slot /></div>',
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

  it('AppDrawer renders content only while open', async () => {
    const { rerender } = render(AppDrawer, {
      props: { open: true, title: '导航' },
      slots: { default: '侧栏内容' },
      global: { stubs: { Drawer: DrawerStub } },
    });
    expect(screen.getByTestId('drawer')).toBeTruthy();
    expect(screen.getByText('侧栏内容')).toBeTruthy();
    await rerender({ open: false });
    expect(screen.queryByTestId('drawer')).toBeNull();
  });
});
