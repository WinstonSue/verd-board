import { electron, writeDesktopLauncher } from './desktop-launcher';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openActiveFile,
  openWorkspaceMenu,
} from '../../web-e2e/src/app-actions';
import { seedEmptyCanvas } from './workspace-disk';

test('Desktop fills the window, registers history and restores saved tabs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-startup-ui-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data');
    const workspace = path.join(directory, 'workspace');
    await mkdir(userData);
    await mkdir(workspace);
    await seedEmptyCanvas(workspace);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VERDBOARD_WORKSPACE_PATH: workspace,
    };

    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await expect(page.locator('.workspace-shell')).toBeVisible();
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
    let page = await launch();
    await openActiveFile(page);
    await expect(
      page.locator('.workspace-pane.is-active svg[aria-label="Frame canvas"]'),
    ).toBeVisible();
    await expect(
      page.getByTestId('save-status').locator('visible=true'),
    ).toHaveAttribute('data-save-state', /^(idle|saved)$/);
    expect(
      await desktop!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened(),
      ),
    ).toBe(false);
    expect(
      await desktop!.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()
          ?.items.flatMap((item) => item.submenu?.items ?? [])
          .some((item) => item.role?.toLowerCase() === 'toggledevtools'),
      ),
    ).toBe(true);
    const history = () =>
      page.evaluate(async () => {
        const api = (
          window as unknown as {
            electronAPI: {
              workspaceHost: {
                listWorkspaceHistory(): Promise<{ name: string }[]>;
              };
            };
          }
        ).electronAPI;
        return api.workspaceHost.listWorkspaceHistory();
      });
    await expect
      .poll(async () => (await history()).map((entry) => entry.name))
      .toContain('workspace');
    const menu = await openWorkspaceMenu(page);
    await expect(
      menu.getByRole('button', { name: 'workspace', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    for (const width of [1200, 1600]) {
      await desktop!.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setSize(width, 900),
        width,
      );
      const contentWidth = await desktop!.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getContentBounds().width,
      );
      await expect
        .poll(() => page.evaluate(() => window.innerWidth))
        .toBe(contentWidth);
      const bounds = await page.evaluate(() => ({
        right: document
          .querySelector('.workspace-shell')!
          .getBoundingClientRect().right,
        inspector: document
          .querySelector('.workspace-pane.is-active .frame-inspector')!
          .getBoundingClientRect().width,
        viewport: window.innerWidth,
      }));
      expect(Math.abs(bounds.right - bounds.viewport)).toBeLessThanOrEqual(1);
      expect(bounds.inspector).toBe(300);
    }
    await page.getByTestId('file-tree-new').click();
    await page.getByRole('menuitem', { name: '新建文档', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    const tabs = await page
      .getByRole('tab')
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-tab-id')),
      );
    const active = await page
      .getByRole('tab', { selected: true })
      .getAttribute('data-tab-id');
    await close();
    page = await launch();
    // Restored active tab is the document; switch back to the canvas only after
    // checking the persisted navigation state.
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      active!,
    );
    expect(
      await page
        .getByRole('tab')
        .evaluateAll((items) =>
          items.map((item) => item.getAttribute('data-tab-id')),
        ),
    ).toEqual(tabs);
    expect(await history()).toBeInstanceOf(Array);
    await expect(page.getByText(/No handler registered/)).toHaveCount(0);
    await close();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
