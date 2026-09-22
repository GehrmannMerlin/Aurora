import { expect, type Locator, type Page } from '@playwright/test';

export async function waitForShell(page: Page): Promise<void> {
  const isCompactViewport = await page.evaluate(
    () => window.matchMedia('(max-width: 959px)').matches,
  );
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
  const isCompactViewport = await page.evaluate(
    () => window.matchMedia('(max-width: 959px)').matches,
  );
  const sidebar = isCompactViewport
    ? drawer.getByRole('navigation', { name: /(?:项目|组织)导航/ })
    : page.getByRole('navigation', { name: /(?:项目|组织)导航/ }).first();
  let drawerOpen = false;
  if (isCompactViewport) {
    const drawerState = await page.evaluate(() => {
      const element = document.querySelector('#nav-drawer');
      if (element === null) return 'absent';
      if (element.classList.contains('p-drawer-leave-active')) return 'leaving';
      return element.getAttribute('data-p')?.includes('open') ? 'open' : 'closed';
    });
    if (drawerState === 'leaving') await expect(drawer).toBeHidden();
    drawerOpen = drawerState === 'open';
  }
  if (isCompactViewport && !drawerOpen) {
    await mobileTrigger.click();
    await expect(drawer).toBeVisible();
    await expect(drawer).not.toHaveClass(/p-drawer-enter-active/);
  }
  await expect(sidebar).toBeVisible();
  return sidebar;
}

export async function closeResponsiveSidebar(page: Page): Promise<void> {
  if (await page.locator('#nav-drawer').isVisible()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('#nav-drawer')).toBeHidden();
  }
}
