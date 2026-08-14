import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

let server: { origin: string; close(): Promise<void> } | undefined;

async function setMockScope(
  page: Page,
  type: 'workspace' | 'organization' | 'project',
  id?: string,
): Promise<void> {
  await page.evaluate(
    ([scopeType, scopeId]) =>
      fetch('/__mock/scope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: scopeType, id: scopeId }),
      }),
    [type, id],
  );
}

async function setSessionAuthenticated(page: Page, authenticated: boolean): Promise<void> {
  await page.evaluate(
    ({ origin, value }) =>
      fetch(`${origin}/__mock/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authenticated: value }),
      }),
    { origin: server!.origin, value: authenticated },
  );
}

/** Load the app once and wait for the MSW-backed shell so the worker is active. */
async function primeApp(page: Page): Promise<void> {
  await page.goto(`${server!.origin}/`);
  await expect(page.getByRole('navigation', { name: '全局导航' })).toBeVisible();
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

// PLT-07 minimal acceptance: one real Chromium user chain through the DAT-18
// release/source-map workspace and the DAT-19 alert workspace, asserting the real
// views render (no fatal page error, no unavailable capability stub).
test('PLT-07 smoke: releases → source maps → alerts render real views', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await primeApp(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await setSessionAuthenticated(page, true);

  // C8: release list is a real view with real releases.
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/releases`);
  await expect(page.getByTestId('project-releases-view')).toBeVisible();
  await expect(page.getByTestId('release-list')).toBeVisible();
  await expect(page.getByTestId('delivery-list')).toBeVisible();
  await expect(page.getByTestId('delivery-detail')).toBeVisible();

  // Navigate into a release detail → C9 source-map workspace renders.
  await page.getByTestId('release-list').locator('a').first().click();
  await expect(page.getByTestId('project-release-detail-view')).toBeVisible();
  await expect(page.getByTestId('project-source-maps-view')).toBeVisible();
  await expect(page.getByTestId('source-map-files')).toBeVisible();
  await expect(page.getByTestId('source-map-file-actions')).toBeVisible();
  const sourceMapFile = page.getByTestId('source-map-file-sm_test_1');
  await expect(sourceMapFile).toHaveAttribute('aria-pressed', 'false');
  await sourceMapFile.focus();
  await page.keyboard.press('Enter');
  await expect(sourceMapFile).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('source-map-selected-file')).toContainText('/assets/app.js');

  // C10: alerts workspace renders both tabs with real projections.
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/alerts`);
  await expect(page.getByTestId('project-alerts-view')).toBeVisible();
  await expect(page.getByTestId('tab-instances')).toBeVisible();
  await expect(page.getByTestId('tab-rules')).toBeVisible();
  await expect(page.getByTestId('alert-instances-toolbar')).toBeVisible();
  await page.getByTestId('tab-instances').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/tab=rules/);
  await expect(page.getByTestId('alert-rules-toolbar')).toBeVisible();
  await expect(page.getByTestId('tab-rules')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('tab-rules')).toBeFocused();

  // C11 remains reachable from the rules tab; the C12 instance view is read-only.
  await page.getByTestId('alert-rule-create-link').click();
  await expect(page.getByTestId('project-alert-rule-form-view')).toBeVisible();
  await expect(page.getByTestId('alert-rule-form')).toBeVisible();
  await page.goto(
    `${server!.origin}/organizations/org_test_1/projects/prj_test_1/alerts/instances/instance_test_1`,
  );
  await expect(page.getByTestId('project-alert-instance-detail-view')).toBeVisible();
  await expect(page.getByTestId('alert-instance-evidence')).toBeVisible();
  await expect(page.getByTestId('project-alert-instance-detail-view').getByRole('button')).toHaveCount(0);

  // The delivery workspace remains usable on a narrow viewport and has no axe violations.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/releases/release_test_1`);
  await expect(page.getByTestId('delivery-list')).toBeVisible();
  await expect(page.getByTestId('delivery-detail')).toBeVisible();
  await expect(new AxeBuilder({ page }).analyze()).resolves.toHaveProperty('violations', []);

  // No fatal page error and no capability-not-provided stub on the visited pages.
  expect(pageErrors).toEqual([]);
  await expect(page.getByText('capability-not-provided')).toHaveCount(0);
});
