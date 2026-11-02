import { type Page } from '@playwright/test';

export async function openActiveFile(page: Page) {
  const active = page
    .locator('.file-tree-file.is-active .file-tree-main')
    .first();
  await page.locator('.file-tree-file .file-tree-main').first().waitFor();
  await (
    (await active.count())
      ? active
      : page.locator('.file-tree-file .file-tree-main').first()
  ).click();
}

export async function openAppMenu(page: Page) {
  const trigger = page.getByTestId('app-menu-trigger').locator('visible=true');
  if (!(await trigger.isVisible())) await openActiveFile(page);
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click({ timeout: 5000 }).catch(() =>
      // Workspace pane swaps keep hidden panes mounted; the visible trigger
      // can flicker in and out of hit-test reach during the transition.
      trigger.dispatchEvent('click'),
    );
  return page.getByRole('menu', { name: /^(更多|More)$/ });
}

export async function selectAppAction(page: Page, label: string) {
  const menu = await openAppMenu(page);
  await menu.getByRole('menuitem', { name: label, exact: true }).click();
}

export async function openSettings(page: Page) {
  await page.getByTestId('workspace-my').click();
  return page.getByTestId('my-page');
}

export async function setAppLanguage(page: Page, language: 'zh' | 'en') {
  const settings = await openSettings(page);
  await settings.getByTestId('settings-language').selectOption(language);
  await page.getByTestId('my-back').click();
}

export async function openWorkspaceMenu(page: Page) {
  const trigger = page.getByTestId('workspace-menu-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click();
  return page.getByTestId('workspace-switcher-dialog');
}

export async function selectWorkspaceAction(page: Page, label: string) {
  const menu = await openWorkspaceMenu(page);
  await menu.getByRole('button', { name: label, exact: true }).click();
}

export async function openTrash(page: Page) {
  if (!(await page.getByTestId('workspace-settings-page').isVisible())) {
    const menu = await openWorkspaceMenu(page);
    await menu
      .getByRole('button', { name: /^(工作区设置|Workspace settings)$/ })
      .click();
  }
  await page.getByTestId('settings-nav-workspace.trash').click();
  return page.getByTestId('workspace-trash');
}
