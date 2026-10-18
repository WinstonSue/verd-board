import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
} from '@playwright/test';
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
    await writeFile(
      launcher,
      [
        "const {app} = require('electron');",
        `app.setPath('userData', ${JSON.stringify(userData)});`,
        `require(${JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js'))});`,
      ].join('\n'),
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
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
    await chooseFolder();
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-folder').click();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'selected',
    );
    await expect(
      page.locator(
        '.workspace-pane.is-active [data-cell-kind="frame-reference"]',
      ),
    ).toHaveCount(0);
    await close();

    delete env.VERDBOARD_WORKSPACE_PATH;
    page = await launch();
    await expect(page.locator('.workspace-sidebar-header')).toHaveText(
      'selected',
    );
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-builtin').click();
    await openWorkspaceMenu(page);
    await expect(page.getByTestId('workspace-open-builtin')).toBeDisabled();
    await page.keyboard.press('End');
    await expect(page.getByTestId('workspace-open-folder')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await expect(
      page.locator(
        '.workspace-pane.is-active [data-cell-kind="frame-reference"]',
      ),
    ).toHaveCount(8);
    await page.getByRole('button', { name: '架构图', exact: true }).click();
    const realDiagrams = page.locator(
      '[data-entry-kind="file"] .file-tree-name[title^="架构图/"]',
    );
    await expect(realDiagrams).toHaveCount(8);
    await page.screenshot({
      path: test.info().outputPath('actual-directory-and-shortcuts.png'),
    });
    await expect(page.locator('[data-entry-kind="shortcut"]')).toHaveCount(8);
    const first = realDiagrams.first();
    const firstId = (await first.locator('..').getAttribute('data-file-id'))!;
    await first.click();
    const activeCanvas = page.locator(
      '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"]',
    );
    await activeCanvas.evaluate((node) =>
      node.setAttribute('data-directory-instance', 'same-source'),
    );
    await page
      .locator(
        `[data-entry-kind="shortcut"][data-file-id="${firstId}"] .file-tree-name`,
      )
      .click();
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
    await page
      .getByRole('button', { name: /回到内置工作区|Open built-in workspace/ })
      .click();
    await expect(
      page.locator(
        '.workspace-pane.is-active [data-cell-kind="frame-reference"]',
      ),
    ).toHaveCount(8);
    await openWorkspaceMenu(page);
    await expect(page.getByTestId('workspace-open-builtin')).toBeDisabled();
    await page.keyboard.press('End');
    await expect(page.getByTestId('workspace-open-folder')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await close();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
