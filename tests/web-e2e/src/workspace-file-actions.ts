import { expect, type Page } from '@playwright/test';

export const directoryRow = (page: Page, name: string) => {
  const label = page.locator('.file-tree-label', {
    hasText: new RegExp(`^${name}$`),
  });
  return page.locator('.file-tree-dir').filter({ has: label });
};

export async function folderAction(page: Page, name: string, action: string) {
  await directoryRow(page, name).locator('.file-tree-more').click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: action, exact: true })
    .click();
}

export async function createFolder(page: Page, name: string, parent?: string) {
  if (parent) await folderAction(page, parent, '在此新建文件夹…');
  else
    await page
      .locator('.file-tree-header')
      .getByRole('button', { name: '新建文件夹', exact: true })
      .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  if (parent) await expect(directoryRow(page, name)).toBeVisible();
}

export async function trashFolder(page: Page, name: string) {
  await folderAction(page, name, '移入回收站');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('文件夹及全部内容');
  await dialog.getByRole('button', { name: '确定', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(directoryRow(page, name)).toHaveCount(0);
}
