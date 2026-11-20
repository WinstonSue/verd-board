import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openSettings, openWorkspaceMenu } from '../../web-e2e/src/app-actions';
import {
  exerciseNativePackage,
  importAndReadNativePackage,
} from '../../helpers/workspace-package';

test('Desktop native attachment packages cross workspaces and preserve saved names and resources after restart', async () => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-closure-'));
  let desktop: ElectronApplication | undefined;
  try {
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const launch = async (workspace: string) => {
      desktop = await electron.launch({
        args: [launcher],
        env: {
          ...process.env,
          VERDBOARD_WORKSPACE_PATH: path.join(directory, workspace),
        },
      });
      const page = await desktop.firstWindow();
      await expect(page.getByTestId('workspace-menu-trigger')).toBeVisible();
      return page;
    };
    const close = async () => {
      const page = await desktop!.firstWindow();
      const closed = page.waitForEvent('close');
      await desktop!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await closed;
      await desktop!.close();
      desktop = undefined;
    };
    let page = await launch('source');
    await openWorkspaceMenu(page);
    for (const id of [
      'workspace-open-folder',
      'workspace-open-builtin',
      'workspace-open-patterns',
    ])
      await expect(page.getByTestId(id)).toBeVisible();
    await page.keyboard.press('Escape');
    const { exported, assets } = await exerciseNativePackage(
      page,
      async (action) => {
        const target = path.join(directory, 'exported.verd');
        await desktop!.evaluate(({ session }, target) => {
          (globalThis as any).__closureDownloadState = null;
          session.defaultSession.once('will-download', (_event, item) => {
            item.setSavePath(target);
            item.once('done', (_event, state) => {
              (globalThis as any).__closureDownloadState = state;
            });
          });
        }, target);
        await action();
        await expect
          .poll(() =>
            desktop!.evaluate(() => (globalThis as any).__closureDownloadState),
          )
          .toBe('completed');
        return readFile(target);
      },
    );
    await close();
    page = await launch('destination');
    await importAndReadNativePackage(page, exported, assets);
    await openSettings(page);
    await page.getByTestId('settings-nav-workspace.project').click();
    await page.getByTestId('workspace-settings-name').fill('Restored library');
    await page.getByTestId('workspace-settings-name').press('Tab');
    await expect(page.getByTestId('settings-workspace-save')).toContainText(
      '已保存',
    );
    await page.getByTestId('my-back').click();
    const menu = await openWorkspaceMenu(page);
    await menu.getByRole('searchbox').fill('Restored library');
    await expect(
      menu.locator('.workspace-switcher-text[title="Restored library"]'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await close();
    page = await launch('destination');
    await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
      'Restored library',
    );
    await expect(
      page.locator('.workspace-pane.is-active').getByAltText('Package image'),
    ).toBeVisible();
    await expect(
      page
        .locator('.workspace-pane.is-active')
        .getByText('reference.pdf', { exact: true }),
    ).toBeVisible();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
