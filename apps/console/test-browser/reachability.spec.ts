import { expect, test, type Page } from '@playwright/test';
import { startSpaServer } from './serve-spa';
import { closeResponsiveSidebar, openResponsiveSidebar, waitForShell } from './shell-helpers';

let server: { origin: string; close(): Promise<void> } | undefined;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '$&');
}

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
  await waitForShell(page);
}

test.beforeAll(async () => {
  server = await startSpaServer();
});

test.afterAll(async () => {
  await server?.close();
});

// PLT-05/06 flip C1—C7 to real monitoring views (consuming real public Queries).
// The remaining project entries stay honest unavailable stubs until PLT-07/08.
const REAL_PROJECT_ENTRIES: ReadonlyArray<{ name: string; path: string; view: string }> = [
  {
    name: '接入',
    path: '/organizations/org_test_1/projects/prj_test_1/onboarding',
    view: 'project-onboarding-view',
  },
  {
    name: '概览',
    path: '/organizations/org_test_1/projects/prj_test_1/overview',
    view: 'project-overview-view',
  },
  {
    name: '数据状态',
    path: '/organizations/org_test_1/projects/prj_test_1/data-status',
    view: 'project-data-status-view',
  },
  {
    name: '问题',
    path: '/organizations/org_test_1/projects/prj_test_1/issues',
    view: 'project-issues-view',
  },
  {
    name: '请求',
    path: '/organizations/org_test_1/projects/prj_test_1/requests',
    view: 'project-requests-view',
  },
  {
    name: '性能',
    path: '/organizations/org_test_1/projects/prj_test_1/performance',
    view: 'project-performance-view',
  },
  // PLT-07/08 flip the release/alert/access/settings entries to real views.
  {
    name: '发布',
    path: '/organizations/org_test_1/projects/prj_test_1/releases',
    view: 'project-releases-view',
  },
  {
    name: '告警',
    path: '/organizations/org_test_1/projects/prj_test_1/alerts',
    view: 'project-alerts-view',
  },
  {
    name: '访问',
    path: '/organizations/org_test_1/projects/prj_test_1/access',
    view: 'project-access-view',
  },
  {
    name: '客户端密钥',
    path: '/organizations/org_test_1/projects/prj_test_1/client-keys',
    view: 'project-client-keys-view',
  },
  {
    name: '设置',
    path: '/organizations/org_test_1/projects/prj_test_1/settings',
    view: 'project-settings-view',
  },
];

const ORG_ENTRIES: ReadonlyArray<{ name: string; path: string; view: string }> = [
  { name: '成员', path: '/organizations/org_test_1/members', view: 'members-view' },
  { name: '设置', path: '/organizations/org_test_1/settings', view: 'settings-view' },
  { name: '用量', path: '/organizations/org_test_1/usage', view: 'usage-view' },
  { name: '令牌', path: '/organizations/org_test_1/tokens', view: 'tokens-view' },
  { name: '审计', path: '/organizations/org_test_1/audit', view: 'audit-view' },
  { name: '回收站', path: '/organizations/org_test_1/trash', view: 'trash-view' },
];

test('every project sidebar entry is reachable by real click — PLT-05/06/07/08 real views render', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  const sidebar = await openResponsiveSidebar(page);
  for (const entry of REAL_PROJECT_ENTRIES) {
    await sidebar.getByRole('link', { name: entry.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(entry.path)));
    await expect(page.getByTestId(entry.view)).toBeVisible();
  }
  // C4 issue detail (menu:false) is directly reachable and renders the real view.
  await page.goto(
    `${server!.origin}/organizations/org_test_1/projects/prj_test_1/issues/issue_test_1`,
  );
  await expect(page.getByTestId('project-issue-detail-view')).toBeVisible();
});

test('global rail workspace, notifications and account entries are reachable by real click', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.reload();
  await expect(page.getByRole('link', { name: '工作空间' })).toBeVisible();
  await page.getByRole('link', { name: '工作空间', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole('link', { name: '工作空间', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  // PLT-09: 通知 now renders the real D1 notification center (not an unavailable stub).
  await page.getByRole('link', { name: '通知', exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('link', { name: '通知', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('notifications-view')).toBeVisible();
  await page.getByRole('link', { name: '账号安全', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByRole('link', { name: '账号安全', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('account-security-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: '账号安全', level: 1 })).toBeVisible();
});
test('every organization sidebar entry is reachable by real click after switching scope', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'organization', 'org_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/members`);
  const sidebar = await openResponsiveSidebar(page);
  for (const entry of ORG_ENTRIES) {
    await sidebar.getByRole('link', { name: entry.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(escapeRegExp(entry.path)));
    await expect(page.getByTestId(entry.view)).toBeVisible();
  }
});

test('scope switch menus activate authorized organization and project targets', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  await waitForShell(page);
  await page.getByRole('button', { name: '组织：Acme' }).click();
  const organizationMenu = page.getByRole('menu', { name: '选择组织' });
  await expect(organizationMenu).toBeVisible();
  const organizationMenuBox = await organizationMenu.boundingBox();
  expect(organizationMenuBox).not.toBeNull();
  if ((page.viewportSize()?.width ?? 0) >= 768 && organizationMenuBox !== null) {
    const menuIsHitTestVisible = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('#organization-scope-menu') !== null,
      {
        x: organizationMenuBox.x + organizationMenuBox.width / 2,
        y: organizationMenuBox.y + Math.min(organizationMenuBox.height / 2, 20),
      },
    );
    expect(menuIsHitTestVisible).toBe(true);
  }
  await page.getByRole('menuitem', { name: 'Acme（当前）' }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page.goto(`${server!.origin}/organizations/org_test_1/members`);
  await expect(page.getByRole('button', { name: '组织：Acme' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const organizationSidebar = await openResponsiveSidebar(page);
  await expect(organizationSidebar.getByRole('link', { name: '成员', exact: true })).toBeVisible();
  await closeResponsiveSidebar(page);

  await page.getByRole('button', { name: '项目：Web' }).click();
  await page.getByRole('menuitem', { name: 'Web' }).click();
  await expect(page).toHaveURL(/\/organizations\/org_test_1\/projects\/prj_test_1\/overview$/);
  await expect(page.getByRole('button', { name: '项目：Web' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const projectSidebar = await openResponsiveSidebar(page);
  await expect(projectSidebar.getByRole('link', { name: '概览', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('scope menus support keyboard open, selection, and Escape focus restoration', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);

  const organizationTrigger = page.getByRole('button', { name: '组织：Acme' });
  await organizationTrigger.focus();
  await page.keyboard.press('ArrowDown');
  const organizationMenu = page.getByRole('menu', { name: '选择组织' });
  await expect(organizationMenu).toBeVisible();
  await expect(organizationMenu.getByRole('menuitem', { name: 'Acme（当前）' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(organizationMenu).toBeHidden();
  await expect(organizationTrigger).toBeFocused();

  const projectTrigger = page.getByRole('button', { name: '项目：Web' });
  await projectTrigger.focus();
  await page.keyboard.press('ArrowDown');
  const projectMenu = page.getByRole('menu', { name: '选择项目' });
  await expect(projectMenu).toBeVisible();
  await expect(projectMenu.getByRole('menuitem', { name: 'Web（当前）' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(projectMenu).toBeHidden();
  await expect(page).toHaveURL(/\/organizations\/org_test_1\/projects\/prj_test_1\/overview$/);
});

test('desktop content scroll keeps the layered navigation fixed, sized, and active', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);

  const sidebar = page.locator('.au-desktop-context');
  const rail = page.locator('.au-desktop-rail');
  const content = page.locator('.au-content');
  const overview = page.getByRole('link', { name: '概览', exact: true });
  const sidebarBefore = await sidebar.boundingBox();
  const railBefore = await rail.boundingBox();
  expect(sidebarBefore).not.toBeNull();
  expect(railBefore).not.toBeNull();
  expect(railBefore!.width).toBe(64);
  expect(sidebarBefore!.width).toBe(232);
  expect(sidebarBefore!.height).toBeGreaterThanOrEqual(639);
  await expect(overview).toHaveAttribute('aria-current', 'page');

  const rowStyle = await overview.evaluate((element) => {
    const style = getComputedStyle(element);
    return { minHeight: Number.parseFloat(style.minHeight), justifyContent: style.justifyContent };
  });
  expect(rowStyle.minHeight).toBeGreaterThanOrEqual(36);
  expect(rowStyle.justifyContent).toBe('flex-start');

  const scrollTop = await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  const sidebarAfter = await sidebar.boundingBox();
  expect(sidebarAfter?.y).toBe(sidebarBefore?.y);
});

test('a nav entry is reachable by keyboard (focus + Enter)', async ({ page }) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');
  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  const sidebar = await openResponsiveSidebar(page);
  const overview = sidebar.getByRole('link', { name: '概览', exact: true });
  await overview.focus();
  await expect(overview).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/organizations\/org_test_1\/projects\/prj_test_1\/overview$/);
  await expect(page.getByTestId('project-overview-view')).toBeVisible();
});

test('project monitoring entry pages expose the calm authority, evidence, and action hierarchy', async ({
  page,
}) => {
  await page.goto(`${server!.origin}/`);
  await waitForShell(page);
  await setMockScope(page, 'project', 'prj_test_1');

  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/overview`);
  await expect(page.getByTestId('overview-status')).toBeVisible();
  await expect(page.getByTestId('overview-evidence')).toBeVisible();
  await expect(page.getByTestId('overview-actions')).toBeVisible();
  await expect(page.getByText('正在接收', { exact: true })).toBeVisible();
  await expect(page.getByText('project.requests', { exact: true })).toHaveCount(0);
  await expect(page.locator('svg[role="img"], canvas')).toHaveCount(0);

  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/onboarding`);
  await expect(page.getByTestId('onboarding-guide')).toBeVisible();
  await expect(page.locator('.mon-onboarding-sequence pre')).toHaveCount(2);

  await page.goto(`${server!.origin}/organizations/org_test_1/projects/prj_test_1/data-status`);
  await expect(page.getByTestId('ds-authority')).toBeVisible();
  await expect(page.getByTestId('ds-stages')).toBeVisible();
  await expect(page.getByTestId('ds-trust-evidence')).toBeVisible();
  await expect(page.getByTestId('ds-actions')).toBeVisible();
});
test('platform G13 resource-policy target renders the real D2 view (not an unavailable stub)', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, true);
  await page.goto(`${server!.origin}/platform/resource-policies`);
  // PLT-10c makes platform.resource-policies a real D2 view; the test-mode
  // capability probe resolves to a platform admin, so the real effective-policy
  // table renders (never an unavailable stub and never fabricated data).
  await expect(page.getByTestId('resource-policy-view')).toBeVisible();
  await expect(page.getByTestId('rp-effective-policy')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(1);
});

test('auth routes render the real PLT-03 views (not unavailable stubs) when signed out', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, false);
  await page.goto(`${server!.origin}/login`);
  await expect(page.getByTestId('auth-shell')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '全局导航' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: /(?:项目|组织)导航/ })).toHaveCount(0);
  await expect(page.getByTestId('login-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: '登录', level: 1 })).toBeVisible();
  await page.goto(`${server!.origin}/register`);
  await expect(page.getByTestId('auth-shell')).toBeVisible();
  await expect(page.getByTestId('register-view')).toBeVisible();
  await expect(page.getByRole('heading', { name: '注册', level: 1 })).toBeVisible();
});

test('the authentication shell uses a desktop brand panel and a compact mobile form layout', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, false);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${server!.origin}/login`);
  await expect(page.locator('.au-auth-shell__brand')).toBeVisible();
  await expect(page.locator('.au-auth-shell__form-region')).toHaveCSS('width', '420px');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.au-auth-shell__brand')).toBeHidden();
  await expect(page.locator('.au-auth-shell__compact-brand')).toBeVisible();
  await expect(page.getByTestId('login-view')).toBeVisible();
});

test('an authenticated user visiting an auth-only route is redirected to the workspace', async ({
  page,
}) => {
  await primeApp(page);
  await setSessionAuthenticated(page, true);
  await page.goto(`${server!.origin}/login`);
  await expect(page).toHaveURL(/\/workspace$/);
});
