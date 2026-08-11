import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: 'line',
  testDir: './test-browser',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: { headless: true },
  workers: 1,
});
