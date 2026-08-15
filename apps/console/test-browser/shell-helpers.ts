import { expect, type Locator, type Page } from '@playwright/test';

export async function waitForShell(page: Page): Promise<void> {
  const isCompactViewport = await page.evaluate(() => window.matchMedia('(max-width: 959px)').matches);
  if (isCompactViewport) {
    await expect(page.getByRole('button', { name: '导航', exact: true })).toBeVisible();
    return;
  }
  await expect(page.getByRole('navigation', { name: '全局导航' }).first()).toBeVisible();
}

export async function openResponsiveSidebar(page: Page): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForShell(page);
  const mobileTrigger = page.getByRole('button', { name: '导航', exact: true });
  const drawer = page.locator('#nav-drawer');
  if ((await mobileTrigger.isVisible()) && !(await drawer.isVisible())) {
    await mobileTrigger.click();
    await expect(drawer).toBeVisible();
  }
  const sidebar = page.getByRole('navigation', { name: /(?:项目|组织)导航/ }).filter({ visible: true });
  await expect(sidebar).toBeVisible();
  return sidebar;
}

export async function closeResponsiveSidebar(page: Page): Promise<void> {
  if (await page.locator('#nav-drawer').isVisible()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-drawer')).toBeHidden();
  }
}
