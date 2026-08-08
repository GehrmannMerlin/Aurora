import { render, screen } from '@testing-library/vue';
import { describe, expect, it } from 'vitest';
import App from '../src/App.vue';

describe('console bootstrap', () => {
  it('mounts the application root', () => {
    render(App);
    expect(screen.getByText('Aurora 管理平台')).toBeTruthy();
  });
});
