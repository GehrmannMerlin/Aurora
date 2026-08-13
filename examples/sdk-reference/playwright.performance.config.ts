import { defineConfig, devices } from '@playwright/test';

/**
 * OPS-02 fixed performance-reference environment. Two tiers only, matching the
 * approved budgets (test-strategy §5 / testing-deploy §8.4): desktop p95 ≤ 20ms
 * and mid-tier mobile p95 ≤ 50ms. Runs only in release CI via `test:performance`
 * (never in PR). No network throttling is applied — the measurement targets SDK
 * synchronous init work, not network.
 */
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [
    { name: 'performance-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'performance-mobile', use: { ...devices['Pixel 5'] } },
  ],
  reporter: 'line',
  testDir: './test-browser',
  testMatch: '**/performance.spec.ts',
  timeout: 120_000,
  use: { headless: true },
  workers: 1,
  retries: 0,
});
