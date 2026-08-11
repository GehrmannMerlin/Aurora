import { defineConfig, devices } from '@playwright/test';

/**
 * OPS-02 reference matrix (executable project set). Derived from the approved
 * browser engines (test-strategy §4) and a minimal representative device
 * set (device classes from test-strategy §4; minimal set per OPS-02 scope).
 * `test:browser` runs only the chromium-desktop core smoke locally; the full
 * matrix runs in nightly/release CI via `test:matrix`.
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
  testMatch: '**/sdk-reference.spec.ts',
  timeout: 30_000,
  use: { headless: true },
  workers: 1,
});
