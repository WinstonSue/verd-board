import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expectWorkspaceSearchFocus } from '../../web-e2e/src/app-actions';
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
    const workspaceNav = page.getByRole('navigation', { name: '当前工作区' });
    await workspaceNav
      .getByRole('button', { name: '工作区', exact: true })
      .click();
    await expect(page.getByTestId('workspace-management-page'))
      .toBeVisible({ timeout: 20000 })
      .catch(async (error) => {
        console.log('BODY', await page.locator('body').innerText());
        throw error;
      });
    await desktop.evaluate(({ dialog }, parent) => {
      let chosen = false;
      dialog.showOpenDialog = async () => {
        if (chosen) return { canceled: true, filePaths: [] };
        chosen = true;
        return { canceled: false, filePaths: [parent] };
      };
    }, directory);
    await page.getByTestId('workspace-menu-trigger').click();
    const modal = page.locator('dialog[open]').last();
    const switcher = page.getByTestId('workspace-switcher');
    await switcher
      .getByRole('button', { name: '新建工作区', exact: true })
      .click();
    const name = modal.getByLabel('名称', { exact: true });
    const parent = modal.getByLabel('父目录', { exact: true });
    const chooseParent = modal.getByRole('button', {
      name: '选择父目录…',
      exact: true,
    });
    const create = modal.getByRole('button', { name: '创建', exact: true });
    await expect(name).toBeFocused();
    await name.fill('资料库');
    await expect(create).toBeDisabled();
    await chooseParent.click();
    await expect(parent).toHaveValue(directory);
    const destination = path.join(directory, '资料库');
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await chooseParent.click();
    await expect(create).toBeEnabled();
    await expect(name).toHaveValue('资料库');
    await expect(parent).toHaveValue(directory);
    await create.click();
    await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
      '资料库',
    );
    await expect(
      page.locator('.file-tree-row[data-entry-kind=file]'),
    ).toHaveCount(0);
    expect((await stat(destination)).isDirectory()).toBe(true);
    await page.keyboard.press('ControlOrMeta+Shift+f');
    const search = page.getByTestId('workspace-search-dialog');
    await expect(
      search.getByRole('button', { name: '全部', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expectWorkspaceSearchFocus(page);

    const trigger = page.getByTestId('workspace-menu-trigger');
    await expect(trigger.locator('svg, .vm-dot')).toHaveCount(0);
    const main = page.locator('.workspace-content');
    const mainBounds = (await main.boundingBox())!;
    const closedNav = (await workspaceNav.boundingBox())!;
    await trigger.press('ArrowDown');
    const recent = switcher
      .locator('.workspace-switcher-row')
      .filter({ hasText: 'initial' });
    const initial = recent.getByRole('button', {
      name: 'initial',
      exact: true,
    });
    await expect(initial).toBeFocused();
    await expect(initial).toHaveCSS('outline-width', '1px');
    await expect(
      switcher.getByRole('heading', { name: '我的工作区' }),
    ).toBeVisible();
    const current = switcher.locator('.workspace-switcher-row[aria-current]');
    await expect(current).toContainText('资料库');
    const currentFill = await workspaceNav
      .getByRole('button', { name: '工作区', exact: true })
      .evaluate((button) => getComputedStyle(button).backgroundColor);
    await current.hover();
    await expect(current).toHaveCSS('background-color', currentFill);
    await expect(switcher.getByRole('searchbox')).toHaveCount(0);
    const panel = (await switcher.boundingBox())!;
    const sidebar = (await page.locator('.workspace-sidebar').boundingBox())!;
    const header = (await page
      .locator('.workspace-sidebar-header')
      .boundingBox())!;
    expect(panel.x).toBeCloseTo(sidebar.x, 0);
    expect(panel.width).toBeCloseTo(sidebar.width - 1, 0);
    expect(panel.y).toBeCloseTo(header.y + header.height, 0);
    expect(await workspaceNav.boundingBox()).toEqual(closedNav);
    expect(await main.boundingBox()).toEqual(mainBounds);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(switcher).toBeHidden();
    await trigger.click();
    await main.click({ position: { x: 8, y: 8 } });
    await expect(switcher).toBeHidden();
    await trigger.click();
    await recent.getByRole('button', { name: '移除记录', exact: true }).click();
    expect((await stat(path.join(directory, 'initial'))).isDirectory()).toBe(
      true,
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
