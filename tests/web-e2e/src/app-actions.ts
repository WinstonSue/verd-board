import { selectSetting } from '../../helpers/settings-controls';
import { expect, type Page } from '@playwright/test';

export async function openDocumentInsert(
  page: Page,
  locale: 'zh' | 'en' = 'zh',
) {
  const document = locale === 'zh' ? '文档' : 'Document';
  const insert = locale === 'zh' ? '插入' : 'Insert';
  await page
    .locator('.workspace-pane.is-active')
    .getByRole('toolbar', { name: 'document', exact: true })
    .getByRole('button', { name: document, exact: true })
    .click();
  await page
    .getByRole('dialog', { name: document, exact: true })
    .getByRole('button', { name: insert, exact: true })
    .click();
  return page.getByRole('dialog', { name: insert, exact: true });
}

export async function openActiveFile(page: Page) {
  const active = page
    .locator('.file-tree-file.is-active .file-tree-main')
    .first();
  await page.locator('.file-tree-file .file-tree-main').first().waitFor();
  const target = (await active.count())
    ? active
    : page.locator('.file-tree-file .file-tree-main').first();
  const fileId = await target.evaluate((element) =>
    element.closest('[data-file-id]')!.getAttribute('data-file-id'),
  );
  await target.click();
  await expect(
    page.locator(`[role="tab"][data-tab-id=${JSON.stringify(fileId)}]`),
  ).toHaveAttribute('aria-selected', 'true');
  await page.locator('.workspace-content[aria-busy="false"]').waitFor();
  const pane = page.locator('.workspace-pane.is-active');
  await pane.waitFor({ state: 'visible' });
  await pane
    .locator(
      'svg[aria-label="Frame canvas"][data-surface="root"], .document-page',
    )
    .first()
    .waitFor({ state: 'visible' });
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
  await selectSetting(settings.getByTestId('settings-language'), language);
  await page.getByTestId('my-back').click();
}

export async function openWorkspaceMenu(page: Page) {
  const trigger = page.getByTestId('workspace-menu-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click();
  return page.getByTestId('workspace-switcher');
}

export async function expectWorkspaceSearchFocus(page: Page) {
  const nav = page.getByRole('navigation', { name: '当前工作区' });
  const workspace = nav.getByRole('button', { name: '工作区', exact: true });
  const trigger = page.locator('.workspace-search-trigger');
  const dialog = page.getByTestId('workspace-search-dialog');
  const content = page.getByTestId('workspace-management-page');

  await expect(content).toBeVisible();
  for (const dismiss of ['button', 'escape'] as const) {
    await trigger.click();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    if (dismiss === 'button')
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveCSS('outline-style', 'none');
    await expect(trigger).toHaveCSS('border-top-width', '0px');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).not.toHaveAttribute('aria-current', 'page');
    await expect(workspace).toHaveAttribute('aria-current', 'page');
    await expect(content).toBeVisible();
  }

  await workspace.focus();
  await page.keyboard.press('Tab');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-width', '1px');
  await expect(trigger).toHaveCSS('outline-offset', '-1px');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('combobox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS('outline-style', 'solid');
  await expect(trigger).toHaveCSS('outline-width', '1px');
  await expect(workspace).toHaveAttribute('aria-current', 'page');
  await expect(content).toBeVisible();
}

export async function openProductHome(page: Page) {
  const home = page.getByTestId('product-home');
  if (!(await home.isVisible()))
    await page
      .locator('.product-navigation')
      .getByRole('button', { name: /^(首页|Home)$/ })
      .click();
  return home;
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

/** History moved into the active file's overflow menu. */
export async function openHistoryAction(page: Page, label: string) {
  const pane = page.locator('.workspace-pane.is-active');
  const document = pane.locator('.document-page');
  if (await document.count()) {
    await document
      .getByRole('toolbar', { name: 'document', exact: true })
      .getByRole('button', { name: /^(文档|Document)$/, exact: true })
      .click();
    return page
      .getByRole('dialog', { name: /^(文档|Document)$/, exact: true })
      .getByRole('button', { name: label, exact: true });
  }
  return (await openAppMenu(page)).getByRole('menuitem', {
    name: label,
    exact: true,
  });
}
export async function selectHistoryAction(page: Page, label: string) {
  await (await openHistoryAction(page, label)).click();
}
