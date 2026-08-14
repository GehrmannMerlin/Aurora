import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import App from '../src/App.vue';
import { router } from '../src/router';
import { pinia } from '../src/stores';

describe('console bootstrap', () => {
  it('mounts the public authentication shell without authenticated navigation', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    await router.isReady();
    expect(await screen.findByTestId('auth-shell')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '全局导航' })).toBeNull();
  });
});
