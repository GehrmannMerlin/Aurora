import { defineConfig, devices } from '@playwright/test';

/**
 * OPS-02 Console reference matrix: representative reference / accessibility
 * specs run across the approved browser engines (chromium/firefox/webkit) plus
 * two mobile viewports (Android Chrome via Pixel 5, iOS Safari via iPhone 14).
 *
 * Only the reference and accessibility specs are selected to avoid a 3-engine ×
 * all-pages × all-device Cartesian explosion. Runs in nightly/release CI via
 * `test:matrix`; the full suite stays on chromium via `test:browser`.
 */
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-android', use: { ...devices['Pixel 5'] } },
    { name: 'webkit-ios', use: { ...devices['iPhone 14'] } },
  ],
  reporter: 'line',
  testDir: './test-browser',
  testMatch: /(axe|focus|reachability|license)\.spec\.ts$/,
  timeout: 30_000,
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  workers: 1,
});
