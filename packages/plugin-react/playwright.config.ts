import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: 'line',
  testDir: './test-browser',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: { headless: true },
  workers: 1,
});
