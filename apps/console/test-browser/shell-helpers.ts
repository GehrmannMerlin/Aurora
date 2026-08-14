import { expect, type Locator, type Page } from '@playwright/test';

export async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: '顶栏导航' })).toBeVisible();
}

export async function openResponsiveSidebar(page: Page): Promise<Locator> {
  await waitForShell(page);
  const mobileTrigger = page.getByRole('button', { name: '导航' });
  if (await mobileTrigger.isVisible()) {
    await mobileTrigger.click();
    await expect(page.locator('#nav-drawer')).toBeVisible();
  }
  const sidebar = page.getByRole('navigation', { name: '侧栏导航' }).filter({ visible: true });
  await expect(sidebar).toBeVisible();
  return sidebar;
}

export async function closeResponsiveSidebar(page: Page): Promise<void> {
  if (await page.locator('#nav-drawer').isVisible()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-drawer')).toBeHidden();
  }
}
