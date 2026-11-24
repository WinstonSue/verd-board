import { chooseLocalDirectory } from './service-actions';
import { serviceFixture } from './service-fixture';
import { expect, test } from './service-fixture';
import {
  openActiveFile,
  openProductHome,
  openSettings,
  openWorkspaceMenu,
} from './app-actions';
import {
  exerciseNativePackage,
  importAndReadNativePackage,
  nativePackageFixture,
} from '../../helpers/workspace-package';

test('fresh home finishes navigation and exposes filesystem workspace entries', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('workspace-management-page')).toBeVisible();
  await expect(page.locator('.workspace-content')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(0);
  const switcher = await openWorkspaceMenu(page);
  await expect(switcher.getByTestId('workspace-open-folder')).toHaveText(
    '导入工作区',
  );
  await expect(switcher.getByTestId('workspace-open-builtin')).toHaveCount(0);
  await expect(switcher.getByTestId('workspace-open-patterns')).toHaveCount(0);
  const home = await openProductHome(page);
  await expect(
    home.getByRole('button', { name: '导入工作区', exact: true }),
  ).toBeVisible();
  await expect(home.getByTestId('workspace-open-builtin')).toBeVisible();
  await expect(home.getByTestId('workspace-open-patterns')).toBeVisible();
  await page
    .locator('.management-navigation nav')
    .getByRole('button', { name: '工作区', exact: true })
    .click();
  await page.reload();
  await expect(page.locator('.workspace-content')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await openActiveFile(page);
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});
test('saved workspace names agree with history and search after reload', async ({
  page,
}) => {
  await page.goto('/');
  const creation = await openProductHome(page);
  await creation
    .getByRole('button', { name: '新建工作区', exact: true })
    .click();
  const nameDialog = page.getByRole('dialog', {
    name: '新建工作区',
    exact: true,
  });
  await nameDialog.getByLabel('名称', { exact: true }).fill('History source');
  await nameDialog
    .getByRole('button', { name: '选择父目录…', exact: true })
    .click();
  await chooseLocalDirectory(page, serviceFixture(page).root);
  await nameDialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    'History source',
  );
  await openSettings(page);
  await page.getByTestId('settings-nav-workspace.project').click();
  await page.getByTestId('workspace-settings-name').fill('Renamed library');
  await page.getByTestId('workspace-settings-name').press('Tab');
  await expect(page.getByTestId('settings-workspace-save')).toContainText(
    '已保存',
  );
  await page.getByTestId('my-back').click();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    'Renamed library',
  );
  await page.reload();
  const searchableHome = await openProductHome(page);
  await searchableHome.getByRole('searchbox').fill('Renamed library');
  await expect(
    searchableHome.getByRole('button', { name: /Renamed library/ }),
  ).toBeVisible();
});
test('native JSON carries nested document attachments into a fresh workspace and survives reload', async ({
  page,
}) => {
  await page.goto('/');
  const { exported, assets } = await exerciseNativePackage(page);
  const menu = await openWorkspaceMenu(page);
  await menu.getByRole('button', { name: '新建工作区', exact: true }).click();
  const dialog = page.locator('dialog[open]').last();
  await dialog.getByLabel('名称', { exact: true }).fill('Package destination');
  await dialog
    .getByRole('button', { name: '选择父目录…', exact: true })
    .click();
  await chooseLocalDirectory(page, serviceFixture(page).root);
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    'Package destination',
  );
  await importAndReadNativePackage(page, exported, assets);
  await page.reload();
  await expect(
    page.locator('.workspace-pane.is-active').getByAltText('Package image'),
  ).toBeVisible();
  await expect(
    page
      .locator('.workspace-pane.is-active')
      .getByText('reference.pdf', { exact: true }),
  ).toBeVisible();
});
test('corrupt or incomplete packages never import their native files', async ({
  page,
}) => {
  await page.goto('/');
  const { value } = nativePackageFixture();
  value.resources.pop();
  await page
    .locator(
      'input[accept=".json,.verd,.verd.json,.verd-doc.json,.md,.markdown"]',
    )
    .setInputFiles({
      name: 'invalid.verd',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
  await expect(page.getByRole('alert')).toContainText(
    'Missing package resource',
  );
  await expect(
    page.locator('.file-tree-name').filter({ hasText: /^Package / }),
  ).toHaveCount(0);
});
