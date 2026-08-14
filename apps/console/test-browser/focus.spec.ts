import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';
import { openResponsiveSidebar, waitForShell } from './shell-helpers';

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

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

test('post-navigation focus lands on the newly rendered page title', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  const sidebar = await openResponsiveSidebar(page);
  await sidebar.getByRole('link', { name: '概览', exact: true }).click();
  await expect(page).toHaveURL(/\/organizations\/org_test_1\/projects\/prj_test_1\/overview$/);
  await expect(page.locator('#page-title')).toBeFocused();
});

test('issue selection remains keyboard reachable and exposes the current-page selection summary', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/issues`);

  const selection = page.getByRole('checkbox', { name: /选择问题/ }).first();
  await selection.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('issues-selection-summary')).toContainText('已选择 1 个问题');
  await expect(page.getByTestId('issues-selection-bar')).toBeVisible();
});

test('pagination clears the current-page issue selection and C5 endpoint selection supports Enter', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  const issueList = page.waitForResponse(
    (response) =>
      response.url().includes('/api/platform/v1/organizations/org_test_1/projects/prj_test_1/issues') &&
      response.request().method() === 'GET',
  );
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/issues?status=open`);
  const issueListBody = (await issueList).json() as Promise<{
    readonly data: { readonly issues: { readonly pagination: { readonly nextCursor?: string } } };
  }>;
  await expect.poll(async () => (await issueListBody).data.issues.pagination.nextCursor).toBe('cursor_2');
  const issueSelection = page.getByRole('checkbox', { name: /选择问题/ }).first();
  await issueSelection.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('issues-selection-summary')).toContainText('已选择 1 个问题');
  await page.getByTestId('issues-load-more').click();
  await expect(page.getByTestId('issues-selection-summary')).toContainText('已选择 0 个问题');

  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/requests`);
  const endpoint = page.getByRole('button', { name: /GET.*\/api\/items/ });
  await endpoint.focus();
  await page.keyboard.press('Enter');
  await expect(endpoint).toHaveAttribute('aria-pressed', 'true');
});
