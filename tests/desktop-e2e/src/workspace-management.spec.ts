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
    const recent = modal.locator('.workspace-switcher-row').filter({
      hasText: 'initial',
    });
    const search = modal.getByRole('searchbox', { name: '查找工作区' });
    const current = modal.locator('.workspace-switcher-row[aria-current]');
    const currentName = current.locator('.workspace-switcher-text');
    const badge = current.getByText('当前', { exact: true });
    const nameBox = (await currentName.boundingBox())!;
    const badgeBox = (await badge.boundingBox())!;
    expect(badgeBox.x - nameBox.x - nameBox.width).toBeCloseTo(8, 0);
    await expect(search).toBeFocused();
    await expect(search).toHaveCSS('outline-style', 'none');
    const focusedBorder = await search.evaluate(
      (input) => getComputedStyle(input).borderColor,
    );
    const settings = modal.getByRole('button', {
      name: '工作区设置',
      exact: true,
    });
    await settings.hover();
    await expect(settings).not.toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    const hoverBackground = await settings.evaluate(
      (item) => getComputedStyle(item).backgroundColor,
    );
    await recent.hover();
    await expect(recent).toHaveCSS('background-color', hoverBackground);
    await expect(search).toBeFocused();
    await expect(search).toHaveCSS('border-color', focusedBorder);
    await page.keyboard.press('ArrowDown');
    const recentName = recent.getByRole('button', {
      name: 'initial',
      exact: true,
    });
    await expect(recentName).toBeFocused();
    await expect(search).not.toHaveCSS('border-color', focusedBorder);
    await expect(recent).not.toHaveCSS('background-color', hoverBackground);
    await expect(recentName).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(badge).toBeVisible();
    expect((await badge.boundingBox())?.x).toBe(badgeBox.x);
    await recent.getByRole('button', { name: '移除记录', exact: true }).click();
    expect((await stat(path.join(directory, 'initial'))).isDirectory()).toBe(
      true,
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
