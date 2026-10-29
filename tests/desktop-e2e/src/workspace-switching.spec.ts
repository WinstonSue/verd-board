import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

test('Desktop remembers a selected folder, recovers a missing folder and returns to its built-in workspace', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-switch-e2e-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data');
    const source = path.join(directory, 'builtin');
    const selected = path.join(directory, 'selected');
    const initial = path.join(directory, 'initial');
    await mkdir(userData);
    await cp(path.join(root, 'workspace'), source, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(path.join(root, 'workspace'), file)
          .split(path.sep)
          .includes('.verdboard'),
    });
    const diagramPaths = (await readdir(path.join(source, '架构图')))
      .filter((name) => name.endsWith('.verd.json'))
      .map((name) => `架构图/${name}`);
    const canvasBytes = () =>
      Promise.all(
        ['项目导览.verd.json', ...diagramPaths].map((file) =>
          readFile(path.join(source, file), 'utf8'),
        ),
      );
    const originalCanvases = await canvasBytes();
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env = { ...process.env };

    env.VERDBOARD_WORKSPACE_PATH = initial;
    env.VERDBOARD_BUILTIN_WORKSPACE_PATH = source;
    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      return desktop.firstWindow();
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
    const chooseFolder = async () => {
      await desktop!.evaluate(({ dialog }, directoryPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [directoryPath],
        });
      }, selected);
    };
    let page = await launch();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'initial',
    );
    await desktop!.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-folder').click();
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'initial',
    );
    const initialFrame = await page
      .getByRole('tab', { selected: true })
      .getAttribute('data-tab-id');
    await chooseFolder();
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-folder').click();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'selected',
    );
    await expect(
      page.locator(
        '.workspace-pane.is-active [data-cell-kind="frame-reference"]:not([data-reference-card])',
      ),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: /^(新建文档|New document)$/ })
      .click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    const selectedTab = await page
      .getByRole('tab', { selected: true })
      .getAttribute('data-tab-id');
    await close();

    delete env.VERDBOARD_WORKSPACE_PATH;
    page = await launch();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'selected',
    );
    let menu = await openWorkspaceMenu(page);
    await expect(
      menu.getByRole('menuitem', { name: /selected.*(当前|current)/ }),
    ).toBeDisabled();
    await expect(
      menu.getByRole('menuitem', { name: 'initial', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('workspace-history.png'),
    });
    await page.keyboard.press('End');
    await expect(
      menu.getByRole('menuitem', { name: 'initial', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'initial',
    );
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      initialFrame!,
    );
    menu = await openWorkspaceMenu(page);
    await menu.getByRole('menuitem', { name: 'selected', exact: true }).click();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'selected',
    );
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      selectedTab!,
    );
    await openWorkspaceMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-builtin').click();
    await openWorkspaceMenu(page);
    await expect(page.getByTestId('workspace-open-builtin')).toBeDisabled();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('workspace-open-folder')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await expect(
      page.locator(
        '.workspace-pane.is-active [data-cell-kind="frame-reference"]:not([data-reference-card])',
      ),
    ).toHaveCount(diagramPaths.length);
    await page.getByRole('button', { name: '架构图', exact: true }).click();
    const realDiagrams = page.locator(
      '[data-entry-kind="file"] .file-tree-name[title^="架构图/"]',
    );
    await expect(realDiagrams).toHaveCount(diagramPaths.length);
    await page.screenshot({
      path: test.info().outputPath('actual-directory.png'),
    });
    // Built-in topics are standalone files; reading references do not create ownership shortcuts.
    await expect(page.locator('[data-entry-kind="shortcut"]')).toHaveCount(0);
    const first = realDiagrams.first();
    const firstId = (await first.locator('..').getAttribute('data-file-id'))!;
    await first.click();
    const activeCanvas = page.locator(
      `.workspace-pane.is-active svg[aria-label="Frame canvas"][data-instance-id="${firstId}"][tabindex="0"]`,
    );
    await activeCanvas.evaluate((node) =>
      node.setAttribute('data-directory-instance', 'same-source'),
    );
    await first.click();
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.locator('.workspace-pane')).toHaveCount(2);
    await expect(activeCanvas).toHaveAttribute(
      'data-directory-instance',
      'same-source',
    );
    expect(await canvasBytes()).toEqual(originalCanvases);
    await page
      .locator(
        '[data-entry-kind="file"][data-file-id="board-root"] .file-tree-name',
      )
      .click();
    await chooseFolder();
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-folder').click();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'selected',
    );
    await close();
    await rm(selected, { recursive: true });

    page = await launch();
    await expect(page.getByRole('alert')).toContainText('unavailable');
    await expect(
      page.getByRole('button', { name: 'initial', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'initial', exact: true }).click();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'initial',
    );
    menu = await openWorkspaceMenu(page);
    await menu.getByRole('menuitem', { name: 'selected', exact: true }).click();
    await expect(page.locator('.workspace-banners')).toContainText(
      'unavailable',
    );
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'initial',
    );
    expect(await readdir(directory)).not.toContain('selected');
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-builtin').click();
    await expect(
      page.locator(
        '.workspace-pane.is-active [data-cell-kind="frame-reference"]:not([data-reference-card])',
      ),
    ).toHaveCount(diagramPaths.length);
    await openWorkspaceMenu(page);
    await expect(page.getByTestId('workspace-open-builtin')).toBeDisabled();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('workspace-open-folder')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await close();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
