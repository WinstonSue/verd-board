import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
test('Desktop creates an empty workspace and keeps removed history data on disk', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-management-'));
  let desktop: ElectronApplication | undefined;
  try {
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'initial'),
      },
    });
    const page = await desktop.firstWindow();
    page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
    await expect(page.getByTestId('workspace-management-page'))
      .toBeVisible({ timeout: 20000 })
      .catch(async (error) => {
        console.log('BODY', await page.locator('body').innerText());
        throw error;
      });
    await desktop.evaluate(({ dialog }, parent) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [parent],
      });
    }, directory);
    await page.getByTestId('workspace-menu-trigger').click();
    const modal = page.locator('dialog[open]').last();
    await modal
      .getByRole('button', { name: '新建工作区', exact: true })
      .click();
    await modal.getByRole('textbox').fill('资料库');
    await modal.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
      '资料库',
    );
    await expect(
      page.locator('.file-tree-row[data-entry-kind=file]'),
    ).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await expect(
      page
        .getByTestId('workspace-management-page')
        .getByRole('heading', { name: '搜索', exact: true }),
    ).toBeVisible();
    await page.getByTestId('workspace-menu-trigger').click();
    await modal
      .locator('.workspace-switcher-row')
      .filter({ hasText: 'initial' })
      .getByRole('button', { name: '移除记录', exact: true })
      .click();
    expect((await stat(path.join(directory, 'initial'))).isDirectory()).toBe(
      true,
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
