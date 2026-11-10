import { expect, type Page } from '@playwright/test';
import { openWorkspaceMenu } from './app-actions';

export async function createLocalWorkspace(
  page: Page,
  name: string,
  parent: string,
) {
  const menu = await openWorkspaceMenu(page);
  await menu.getByRole('button', { name: '新建工作区', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作区', exact: true });
  await dialog.getByRole('textbox').fill(name);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await chooseLocalDirectory(page, parent);
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(name);
  // Newly created filesystem workspaces begin empty.
  await page
    .locator('ylib-tabs')
    .getByRole('button', { name: '新建画布', exact: true })
    .click();
  await expect(
    page.locator('.workspace-pane.is-active [data-testid="verd-board"]'),
  ).toBeVisible();
}

export async function chooseLocalDirectory(page: Page, location: string) {
  const picker = page.getByRole('dialog', {
    name: '选择本地文件夹',
    exact: true,
  });
  await picker.getByLabel('文件夹路径').fill(location);
  await picker.getByRole('button', { name: '前往', exact: true }).click();
  await expect(
    picker.getByRole('button', { name: '选择此文件夹' }),
  ).toBeEnabled();
  await picker.getByRole('button', { name: '选择此文件夹' }).click();
}
