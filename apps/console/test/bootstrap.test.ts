import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import App from '../src/App.vue';
import { router } from '../src/router';
import { pinia } from '../src/stores';

describe('console bootstrap', () => {
  it('mounts the application root shell', async () => {
    render(App, { global: { plugins: [pinia, router] } });
    await router.isReady();
    expect(await screen.findByRole('navigation', { name: '顶栏导航' })).toBeTruthy();
  });
});
