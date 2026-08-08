import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';

// Regression gate for the PrimeUI license defect (G09 post-deployment
// stabilization hotfix).
//
// The approved stack (ADR-025) requires open-source PrimeVue. PrimeVue 5.x
// moved to the commercial PrimeUI license: with no license key configured,
// @primeui/license-manager drives @primevue/core's BaseComponent to inject a
// fixed-position "#p-license-host" banner reading "Invalid PrimeUI License"
// into the page, and logs a console warning. The deployed Preview showed this
// banner at bottom-right. This spec fails the browser gate if the banner or a
// license warning ever appears on a real page load — catching the defect class
// at the layer the original shell smoke missed.
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

const ROUTES: ReadonlyArray<{
  name: string;
  path: string;
  scope?: 'workspace' | 'organization' | 'project';
}> = [
  { name: 'root', path: '/' },
  { name: 'workspace', path: '/workspace' },
  {
    name: 'project overview',
    path: '/organizations/org_test_1/projects/prj_test_1/overview',
    scope: 'project',
  },
  {
    name: 'organization settings',
    path: '/organizations/org_test_1/settings',
    scope: 'organization',
  },
];

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('no PrimeUI license banner or warning appears on any shell route', async ({ page }) => {
  const consoleMessages: string[] = [];
  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });

  for (const route of ROUTES) {
    await page.goto(`${server!.origin}${route.path}`);
    if (route.scope) {
      await setMockScope(
        page,
        route.scope,
        route.scope === 'project' ? 'prj_test_1' : 'org_test_1',
      );
      await page.reload();
    }
    await expect(page.getByRole('navigation', { name: '侧栏导航' })).toBeVisible();

    // The banner is injected into a closed shadow root, so it is not matched
    // by normal selectors — assert the host element it creates is absent.
    await expect(page.locator('#p-license-host')).toHaveCount(0);
  }

  const licenseMessages = consoleMessages.filter((message) =>
    /primeui|primevue.*license|invalid primeui/i.test(message),
  );
  expect(licenseMessages).toEqual([]);
});
