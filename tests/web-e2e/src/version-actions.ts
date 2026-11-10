import { expect, type Page } from '@playwright/test';
export async function openVersionSettings(page: Page) {
  if (!(await page.getByTestId('settings-nav-workspace.versions').isVisible()))
    await page.getByTestId('workspace-my').click();
  await page.getByTestId('settings-nav-workspace.versions').click();
  const settings = page.locator(
    '[data-testid="my-page"]:visible, [data-testid="workspace-settings-page"]:visible',
  );
  await expect(settings.getByTestId('version-history-panel')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  return settings;
}
export async function initializeVersions(page: Page) {
  const settings = await openVersionSettings(page);
  await settings
    .getByRole('button', { name: '存储与同步', exact: true })
    .click();
  await settings
    .getByRole('textbox', { name: '姓名', exact: true })
    .fill('Version Tester');
  await settings
    .getByRole('textbox', { name: '邮箱', exact: true })
    .fill('versions@example.com');
  await settings
    .getByRole('button', { name: '初始化 Git 仓库', exact: true })
    .click();
  await expect(settings.getByTestId('git-history-panel')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await settings
    .getByRole('button', { name: '工作区版本', exact: true })
    .click();
  await expect(settings.getByTestId('version-history-panel')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  return settings;
}
export async function closeVersionSettings(page: Page) {
  await page
    .locator(
      '[data-testid="my-back"]:visible,[data-testid="workspace-settings-back"]:visible',
    )
    .click();
}
export async function openScopedVersions(page: Page, path: string) {
  await page
    .locator(`[data-entry-path=${JSON.stringify(path)}]`)
    .first()
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: '版本历史', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '版本历史', exact: true });
  await expect(dialog.getByTestId('version-history-panel')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  return dialog;
}
