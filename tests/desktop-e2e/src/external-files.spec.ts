import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { activeTabTitle } from '../../web-e2e/src/tab-actions';
import { checkFileShortcuts } from './file-shortcuts';

async function closeNativeWindow(desktop: ElectronApplication, page: Page) {
  const closed = page.waitForEvent('close');
  const window = await desktop.browserWindow(page);
  await window.evaluate((window) => window.close());
  await closed;
}

async function clickFileMenu(desktop: ElectronApplication, id: string) {
  await desktop.evaluate(({ BrowserWindow, Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) throw new Error(`Missing File menu item ${id}`);
    const window = BrowserWindow.getFocusedWindow();
    item.click({}, window, window?.webContents);
  }, id);
}

async function writeTrayLauncher(directory: string) {
  const launcher = path.join(directory, 'launch.cjs');
  const capture = path.join(directory, 'tray-menu.cjs');
  await writeFile(
    capture,
    [
      "const { Tray } = require('electron');",
      'const set = Tray.prototype.setContextMenu;',
      'Tray.prototype.setContextMenu = function(menu) { globalThis.verdTrayMenu = menu; return set.call(this, menu); };',
    ].join('\n'),
  );
  await writeDesktopLauncher(
    launcher,
    path.join(directory, 'user-data'),
    capture,
  );
  return launcher;
}

function clickTrayMenu(desktop: ElectronApplication, id: string) {
  return desktop.evaluate(({ BrowserWindow }, id) => {
    const menu = (globalThis as unknown as { verdTrayMenu: Electron.Menu })
      .verdTrayMenu;
    const item = menu.getMenuItemById(id);
    if (!item) throw new Error(`Missing tray command ${id}`);
    const window = BrowserWindow.getFocusedWindow();
    setImmediate(() => item.click({}, window, window?.webContents));
  }, id);
}

async function stubFilePicker(
  desktop: ElectronApplication,
  filePaths: string[],
) {
  await desktop.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({
      canceled: filePaths.length === 0,
      filePaths,
    });
  }, filePaths);
}

const quickCreate = (page: Page) =>
  page.getByRole('button', { name: /^(快速创建|Quick Create)$/ });

const nativeCanvas = (id: string) =>
  JSON.stringify({
    format: 'verd-frame',
    version: 2,
    frame: {
      id,
      kind: 'frame',
      cellType: 'frame',
      name: id,
      geometry: { x: 0, y: 0, width: 960, height: 640 },
      children: [],
      groups: [],
    },
    cells: {},
  });

const nativeDocument = (id: string, title: string, text: string) => ({
  format: 'verd-document',
  version: 1,
  id,
  title,
  text: {
    schemaVersion: 1,
    id,
    kind: 'block',
    plainText: text,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
  },
});

test(
  'dispatches native open and actual size shortcuts in production',
  checkFileShortcuts,
);

test('keeps the tray after closing all windows and restores the product page', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-tray-'));
  let desktop: ElectronApplication | undefined;
  try {
    const launcher = await writeTrayLauncher(directory);
    const application = (desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: undefined,
        VERDBOARD_QUICK_EDIT_PATH: undefined,
      },
    }));
    const page = await application.firstWindow();
    await expect(page.getByTestId('product-home')).toBeVisible();
    await quickCreate(page).click();
    await expect(page.getByTestId('quick-create-page')).toBeVisible();
    await closeNativeWindow(application, page);
    expect(application.windows()).toHaveLength(0);

    const openDiagram = application.waitForEvent('window');
    await clickTrayMenu(application, 'tray-mind');
    const diagram = await openDiagram;
    await expect(
      diagram.locator('[data-cell-kind="mind-root"]').first(),
    ).toBeVisible();
    await closeNativeWindow(application, diagram);

    const main = application.waitForEvent('window');
    await clickTrayMenu(application, 'tray-new-workspace');
    const restored = await main;
    const dialog = restored.getByRole('dialog', {
      name: /^(新建工作区|New workspace)$/,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/^(父目录|Parent folder)$/)).toBeVisible();
    await dialog.getByRole('button', { name: /^(取消|Cancel)$/ }).click();
    await expect(restored.getByTestId('quick-create-page')).toBeVisible();
    await expect(
      restored.getByRole('button', {
        name: '未命名思维导图.verd',
        exact: true,
      }),
    ).toBeVisible();
    await closeNativeWindow(application, restored);
    const closed = application.waitForEvent('close');
    await clickTrayMenu(application, 'tray-quit');
    await closed;
    desktop = undefined;
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens a lightweight file from workspace startup recovery', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-quick-edit-recovery-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const invalidWorkspace = path.join(directory, 'invalid-workspace');
    const source = path.join(directory, 'Recovery note.md');
    const launcher = path.join(directory, 'launch.cjs');
    await writeFile(invalidWorkspace, 'not a directory');
    await writeFile(source, '# Opened during recovery\n');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: invalidWorkspace },
    });
    const page = await desktop.firstWindow();
    await expect(
      page.getByRole('heading', {
        name: /无法打开工作区|Unable to open workspace/,
      }),
    ).toBeVisible();
    await mkdir(path.join(directory, 'user-data/quick-edit'), {
      recursive: true,
    });
    await writeFile(
      path.join(directory, 'user-data/quick-edit', path.basename(source)),
      await readFile(source),
    );
    await quickCreate(page).click();
    const [editor] = await Promise.all([
      desktop.waitForEvent('window'),
      page
        .getByRole('button', { name: path.basename(source), exact: true })
        .click(),
    ]);
    await expect(
      editor.locator('[contenteditable="true"]').first(),
    ).toContainText('Opened during recovery');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('queues startup file requests and routes mixed canvas suffixes to the workspace owner', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-file-owner-'));
  let desktop: ElectronApplication | undefined;
  try {
    const workspace = path.join(directory, 'workspace');
    await mkdir(workspace);
    const source = path.join(workspace, '当前.verd');
    const legacy = path.join(workspace, '旧文件.verd.json');
    await writeFile(source, nativeCanvas('Current'));
    await writeFile(legacy, nativeCanvas('Legacy'));
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    await writeFile(
      launcher,
      [
        "const {ipcMain} = require('electron');",
        'const register = ipcMain.handle.bind(ipcMain);',
        "ipcMain.handle = (channel, listener) => register(channel, channel === 'workspace-host:open' ? async (...args) => { await new Promise(resolve => setTimeout(resolve, 1000)); return listener(...args); } : listener);",
        await readFile(launcher, 'utf8'),
      ].join('\n'),
    );
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
    });
    const page = await desktop.firstWindow();
    await desktop.evaluate(
      ({ app }, filename) =>
        app.emit('open-file', { preventDefault() {} }, filename),
      source,
    );
    await expect(activeTabTitle(page)).toHaveText('Current');
    await stubFilePicker(desktop, [legacy]);
    await clickFileMenu(desktop, 'open-file');
    await expect(activeTabTitle(page)).toHaveText('Legacy');
    expect(
      await desktop.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    await expect(
      page.locator('.file-tree-name[title="当前.verd"]'),
    ).toBeVisible();
    await expect(
      page.locator('.file-tree-name[title="旧文件.verd.json"]'),
    ).toBeVisible();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens multiple files from the File menu and reports invalid selections', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-file-picker-'));
  let desktop: ElectronApplication | undefined;
  try {
    const source = path.join(directory, '原文.md');
    const markdown = path.join(directory, '说明.markdown');
    const canvas = path.join(directory, '旧画布.verd.json');
    const invalid = path.join(directory, '无效.verd');
    await writeFile(source, '# Original\n');
    await writeFile(markdown, '# Picked Markdown\n');
    await writeFile(canvas, nativeCanvas('Picked Canvas'));
    await writeFile(invalid, 'not a canvas');
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({ args: [launcher, source] });
    const initial = await desktop.firstWindow();
    await expect(initial.getByTestId('external-file-editor')).toBeVisible();
    await stubFilePicker(desktop, []);
    await clickFileMenu(desktop, 'open-file');
    expect(desktop.windows()).toEqual([initial]);

    const errors = await desktop.evaluateHandle(({ dialog }) => {
      const details: string[] = [];
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1) as { detail?: string };
        details.push(options.detail ?? '');
        return { response: 0, checkboxChecked: false };
      };
      return details;
    });
    await stubFilePicker(desktop, [source, invalid, markdown, canvas]);
    await clickFileMenu(desktop, 'open-file');
    await expect.poll(() => desktop!.windows().length).toBe(3);
    const [, document, board] = desktop.windows();
    await expect(
      document.locator('[contenteditable="true"]').first(),
    ).toContainText('Picked Markdown');
    await expect(board.locator('svg[aria-label="Frame canvas"]')).toBeVisible();
    await expect
      .poll(() => errors.jsonValue())
      .toEqual([expect.stringMatching(/无效\.verd: .+/)]);
    await errors.dispose();
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('creates and reopens editable files in the app-level quick edit directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-quick-edit-e2e-'));
  let desktop: ElectronApplication | undefined;
  try {
    const workspace = path.join(directory, 'workspace');
    const userData = path.join(directory, 'user-data');
    const quickEdit = path.join(userData, 'quick-edit');
    const existing = path.join(quickEdit, '未命名文档.md');
    const documentFile = path.join(quickEdit, '未命名文档 2.md');
    const canvasFile = path.join(quickEdit, '未命名画布.verd');
    await mkdir(workspace);
    await writeFile(
      path.join(workspace, '工作区画布.verd'),
      nativeCanvas('Workspace'),
    );
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
    });
    const workspacePage = await desktop.firstWindow();
    await expect(
      workspacePage.locator('.file-tree-name[title="工作区画布.verd"]'),
    ).toBeVisible();
    const workspaceHistory = () =>
      workspacePage.evaluate(() => {
        const { electronAPI } = window as unknown as {
          electronAPI: {
            workspaceHost: { listWorkspaceHistory(): Promise<unknown[]> };
          };
        };
        return electronAPI.workspaceHost.listWorkspaceHistory();
      });
    const historyBefore = await workspaceHistory();
    await expect(readdir(quickEdit)).rejects.toMatchObject({ code: 'ENOENT' });

    const revealed = await desktop.evaluateHandle(({ shell }) => {
      const directories: string[] = [];
      shell.openPath = async (directory) => {
        directories.push(directory);
        return '';
      };
      return directories;
    });
    await workspacePage
      .getByRole('button', { name: /^(收起侧栏|Collapse sidebar)$/ })
      .click();
    await expect(workspacePage.locator('.workspace-sidebar')).toHaveClass(
      /management-collapsed/,
    );
    await quickCreate(workspacePage).click();
    await workspacePage
      .getByRole('button', {
        name: /^(在文件管理器中显示|Show in file manager)$/,
      })
      .click();
    await expect
      .poll(() => revealed.jsonValue())
      .toEqual([await realpath(quickEdit)]);
    await workspacePage
      .getByRole('button', { name: /^(展开侧栏|Expand sidebar)$/ })
      .click();
    await revealed.dispose();
    expect(await readdir(quickEdit)).toEqual([]);
    await writeFile(existing, '# Existing draft\n');

    const documentWindow = desktop.waitForEvent('window');
    await workspacePage
      .getByRole('button', { name: /^(新建文件|New file)$/ })
      .click();
    const document = await documentWindow;
    await expect(
      document.locator('.external-file-app__header strong'),
    ).toHaveText('未命名文档 2.md');
    const editor = document.locator('[contenteditable="true"]').first();
    await editor.click();
    await document.keyboard.insertText('轻量编辑正文');
    await document.keyboard.press('ControlOrMeta+s');
    await expect
      .poll(() => readFile(documentFile, 'utf8'))
      .toContain('轻量编辑正文');
    expect(await readFile(existing, 'utf8')).toBe('# Existing draft\n');

    const canvasWindow = desktop.waitForEvent('window');
    await workspacePage
      .getByRole('button', { name: /^(新建图|New diagram)$/ })
      .click();
    await workspacePage
      .getByRole('menuitem', { name: /^(白板|Whiteboard)$/ })
      .click();
    const board = await canvasWindow;
    const canvas = board.locator(
      'svg[aria-label="Frame canvas"][data-surface="root"]',
    );
    const cells = (page: Page) =>
      page.locator('svg[data-surface="root"] [data-cell-kind="geometry"]');
    await expect(canvas).toBeVisible();
    await board.getByRole('button', { name: /^(形状|Shape)$/ }).click();
    await board.getByTestId('shape-rectangle').click();
    await canvas.click({ position: { x: 180, y: 150 } });
    await expect(cells(board)).toHaveCount(1);
    await board.keyboard.press('ControlOrMeta+s');
    await expect
      .poll(
        async () =>
          Object.keys(JSON.parse(await readFile(canvasFile, 'utf8')).cells)
            .length,
      )
      .toBe(1);

    await expect(
      workspacePage.locator('.file-tree-name[title^="未命名"]'),
    ).toHaveCount(0);
    expect(await workspaceHistory()).toEqual(historyBefore);
    expect((await readdir(quickEdit)).sort()).toEqual([
      '未命名文档 2.md',
      '未命名文档.md',
      '未命名画布.verd',
    ]);
    await desktop.close();
    desktop = undefined;

    desktop = await electron.launch({
      args: [launcher, documentFile, canvasFile],
    });
    await expect.poll(() => desktop!.windows().length).toBe(2);
    const [reopenedDocument, reopenedCanvas] = desktop.windows();
    await expect(
      reopenedDocument.locator('[contenteditable="true"]').first(),
    ).toContainText('轻量编辑正文');
    await expect(cells(reopenedCanvas)).toHaveCount(1);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens Markdown in its own editor, preserves untouched bytes and saves back across restart', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-external-markdown-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const source = path.join(directory, '中文 笔记.md');
    const original = '# 原标题\n\n正文\n';
    await writeFile(source, original);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const launch = async () => {
      desktop = await electron.launch({ args: [launcher, source] });
      const page = await desktop.firstWindow();
      await expect(page.getByTestId('external-file-editor')).toBeVisible();
      return page;
    };
    let page = await launch();
    await expect(
      page.locator('[contenteditable="true"]').first(),
    ).toContainText('原标题');
    expect(await readFile(source, 'utf8')).toBe(original);
    expect(await readdir(directory)).not.toContain('.verdscrolls');
    expect(await page.locator('.workspace-sidebar').count()).toBe(0);
    await desktop!.close();
    desktop = undefined;
    expect(await readFile(source, 'utf8')).toBe(original);
    page = await launch();
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.insertText('已编辑');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => readFile(source, 'utf8')).toContain('已编辑');
    await desktop!.close();
    desktop = undefined;
    page = await launch();
    await expect(
      page.locator('[contenteditable="true"]').first(),
    ).toContainText('已编辑');
    expect(await readFile(source, 'utf8')).not.toContain('verd-document');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('opens multiple native files and focuses the existing owner for repeated paths', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-external-windows-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const source = path.join(directory, '原文.md');
    const canvas = path.join(directory, '画布.verd');
    await writeFile(source, '保持原文\n');
    const canvasBytes = JSON.stringify({
      format: 'verd-canvas-bundle',
      version: 1,
      rootFileId: 'external-canvas',
      files: [
        JSON.parse(nativeCanvas('external-canvas')),
        JSON.parse(nativeCanvas('member-b')),
      ],
    });
    await writeFile(canvas, canvasBytes);
    const alias = path.join(directory, '别名.md');
    await symlink(source, alias);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({ args: [launcher, source] });
    const initial = await desktop.firstWindow();
    await expect(initial.getByTestId('external-file-editor')).toBeVisible();
    const newPage = desktop.waitForEvent('window');
    await desktop.evaluate(
      ({ app, dialog }, missing) => {
        dialog.showMessageBox = () =>
          new Promise<{ response: number; checkboxChecked: boolean }>(() => {});
        app.emit('open-file', { preventDefault() {} }, missing);
      },
      path.join(directory, 'missing.verd'),
    );
    await desktop.evaluate(
      ({ app }, filename) =>
        app.emit('open-file', { preventDefault() {} }, filename),
      canvas,
    );
    const opened = await newPage;
    await expect(
      opened.locator('svg[aria-label="Frame canvas"]'),
    ).toBeVisible();
    await opened
      .getByRole('navigation', { name: '文件内页面' })
      .getByRole('button', { name: 'member-b', exact: true })
      .click();
    await expect(
      opened
        .getByRole('navigation', { name: '文件内页面' })
        .getByRole('button', { name: 'member-b', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await closeNativeWindow(desktop, opened);
    const reopenedBundle = desktop.waitForEvent('window');
    await desktop.evaluate(
      ({ app }, filename) =>
        app.emit('open-file', { preventDefault() {} }, filename),
      canvas,
    );
    const bundle = await reopenedBundle;
    await expect(
      bundle
        .getByRole('navigation', { name: '文件内页面' })
        .getByRole('button', { name: 'member-b', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(await readFile(canvas, 'utf8')).toBe(canvasBytes);
    await desktop.evaluate(
      ({ app }, filename) =>
        app.emit('open-file', { preventDefault() {} }, filename),
      alias,
    );
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      )
      .toBe(2);
    await closeNativeWindow(desktop, initial);
    await expect
      .poll(() =>
        desktop!.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
        ),
      )
      .toBe(1);
    const reopenedPage = desktop.waitForEvent('window');
    await desktop.evaluate(
      ({ app }, filename) =>
        app.emit('open-file', { preventDefault() {} }, filename),
      source,
    );
    const reopened = await reopenedPage;
    await expect(
      reopened.locator('[contenteditable="true"]').first(),
    ).toContainText('保持原文');
    expect(await readFile(source, 'utf8')).toBe('保持原文\n');
    expect(await readdir(directory)).not.toContain('.agents');
    expect(await readdir(directory)).not.toContain('.verdscrolls');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps all windows and pending edits when one file fails to save during quit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-external-quit-'));
  let desktop: ElectronApplication | undefined;
  const source = path.join(directory, '只读.md');
  try {
    const other = path.join(directory, '另一份.md');
    await writeFile(source, '# Original\n');
    await writeFile(other, '# Other\n');
    const launcher = await writeTrayLauncher(directory);
    desktop = await electron.launch({ args: [launcher, source, other] });
    await expect.poll(() => desktop!.windows().length).toBe(2);
    const pages = desktop.windows();
    for (const page of pages)
      await expect(page.getByTestId('external-file-editor')).toBeVisible();
    const original = (
      await Promise.all(
        pages.map(async (candidate) =>
          (await candidate
            .locator('.external-file-app__header strong')
            .textContent()) === '只读.md'
            ? candidate
            : undefined,
        ),
      )
    ).find((candidate) => candidate !== undefined)!;
    await chmod(source, 0o444);
    const editor = original.locator('[contenteditable="true"]').first();
    await editor.click();
    await original.keyboard.press('ControlOrMeta+End');
    await original.keyboard.insertText('Pending edit');
    await original.keyboard.press('ControlOrMeta+s');
    await expect(
      original.locator('.external-file-app__header [role="status"]'),
    ).toHaveText('保存失败');
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => {
        (globalThis as { quitSaveFailure?: boolean }).quitSaveFailure = true;
        return { response: 0, checkboxChecked: false };
      };
    });
    await clickTrayMenu(desktop, 'tray-quit');
    await expect
      .poll(() =>
        desktop!.evaluate(
          () => (globalThis as { quitSaveFailure?: boolean }).quitSaveFailure,
        ),
      )
      .toBe(true);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toContainText('Pending edit');
    expect(
      await desktop.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(2);
    expect(await readFile(source, 'utf8')).toBe('# Original\n');
    await chmod(source, 0o644);
    await original.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await original.keyboard.press('ControlOrMeta+s');
    await expect.poll(() => readFile(source, 'utf8')).toContain('Pending edit');
    await desktop.close();
    desktop = undefined;
  } finally {
    await chmod(source, 0o644).catch(() => {});
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('renders Markdown images relative to the source file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-markdown-images-'));
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(path.join(directory, 'images'));
    await writeFile(
      path.join(directory, 'images', 'picture.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const source = path.join(directory, '图片.md');
    await writeFile(source, '![示例](images/picture.png)\n');
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({ args: [launcher, source] });
    const page = await desktop.firstWindow();
    const image = page.locator('img[alt="示例"]');
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    expect(await readFile(source, 'utf8')).toBe(
      '![示例](images/picture.png)\n',
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('restores a single main window and manages recently opened independent files', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-independent-management-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const profile = path.join(directory, 'profile');
    const launcher = path.join(directory, 'launch.cjs');
    const source = path.join(directory, 'Draft.md');
    const renamed = path.join(directory, 'Renamed.md');
    const final = path.join(directory, 'Final.md');
    await writeDesktopLauncher(launcher, profile);
    await writeFile(source, '# Draft text\n');
    desktop = await electron.launch({ args: [launcher, source] });
    const editor = await desktop.firstWindow();
    const editorRoot = editor.getByTestId('external-file-editor');
    await expect(editorRoot).toBeVisible();

    // The native Window command must work when the independent editor is the only window.
    const restored = desktop.waitForEvent('window');
    await clickFileMenu(desktop, 'show-primary-window');
    const main = await restored;
    await quickCreate(main).click();
    await expect(
      main.getByRole('button', { name: 'Draft.md', exact: true }),
    ).toBeVisible();
    await clickFileMenu(desktop, 'show-primary-window');
    expect(desktop.windows()).toHaveLength(2);

    await editorRoot
      .getByRole('button', { name: '重命名', exact: true })
      .click();
    const editorRename = editor.getByRole('dialog', { name: '重命名文件' });
    await editorRename.getByRole('textbox').fill('Renamed');
    await editorRename.getByRole('button', { name: '重命名' }).click();
    await expect(
      editorRoot.locator('.external-file-app__header strong'),
    ).toHaveText('Renamed.md');
    await expect(
      main.getByRole('button', { name: 'Renamed.md', exact: true }),
    ).toBeVisible();
    await expect(readFile(renamed, 'utf8')).resolves.toBe('# Draft text\n');

    await main
      .getByRole('button', { name: '重命名 Renamed.md', exact: true })
      .click();
    const listRename = main.getByRole('dialog', { name: '重命名文件' });
    await listRename.getByRole('textbox').fill('Final');
    await listRename.getByRole('button', { name: '重命名' }).click();
    await expect(
      editorRoot.locator('.external-file-app__header strong'),
    ).toHaveText('Final.md');
    await expect(readFile(final, 'utf8')).resolves.toBe('# Draft text\n');
    await main.getByRole('button', { name: 'Final.md', exact: true }).click();
    expect(desktop.windows()).toHaveLength(2);
    await main
      .getByRole('button', { name: '移到废纸篓 Final.md', exact: true })
      .click();
    await expect(main.getByRole('alert')).toContainText('文件正在编辑');

    await desktop.close();
    desktop = await electron.launch({ args: [launcher] });
    const reopened = await desktop.firstWindow();
    const recent = reopened.getByRole('button', {
      name: 'Final.md',
      exact: true,
    });
    await expect(recent).toBeVisible();
    await reopened
      .getByRole('button', { name: '从最近记录移除 Final.md', exact: true })
      .click();
    await expect(recent).toHaveCount(0);
    await expect(readFile(final, 'utf8')).resolves.toBe('# Draft text\n');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('selects the deepest known workspace and continues a batch after an invalid file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-known-workspace-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'profile');
    const parent = path.join(directory, 'parent');
    const child = path.join(parent, 'child');
    for (const root of [parent, child]) {
      const metadata = path.join(root, '.verdscrolls');
      const name = path.basename(root);
      await mkdir(metadata, { recursive: true });
      await writeFile(
        path.join(metadata, 'config.json'),
        JSON.stringify({
          version: 1,
          value: {
            identity: name,
            name,
            project: { description: '', entryDocumentIds: [] },
          },
        }),
      );
    }
    await mkdir(userData);
    const source = path.join(child, 'Diagram.verd');
    const notes = path.join(parent, 'notes.verd-doc.json');
    await writeFile(source, nativeCanvas('Diagram'));
    const originalNotes = JSON.stringify(
      nativeDocument('notes', 'Notes', 'Original notes'),
    );
    await writeFile(notes, originalNotes);
    const other = path.join(directory, 'Outside.md');
    await writeFile(other, '# Outside\n');
    await writeFile(
      path.join(userData, 'verdboard-global-config.json'),
      JSON.stringify({
        version: 1,
        value: {
          desktopWorkspace: { kind: 'directory', path: parent },
          desktopWorkspaceHistory: [{ path: parent }, { path: child }],
        },
      }),
    );
    const launcher = path.join(directory, 'launch.cjs');
    const fault = path.join(directory, 'faults.cjs');
    await writeFile(
      fault,
      [
        "const {ipcMain} = require('electron');",
        'const register = ipcMain.handle.bind(ipcMain);',
        "ipcMain.handle = (channel, listener) => register(channel, channel === 'workspace-host:commit' ? (event, handle, request) => { if (globalThis.blockWorkspaceWrite && request?.writes?.length) throw new Error('Failed to save workspace'); return listener(event, handle, request); } : listener);",
      ].join('\n'),
    );
    await writeDesktopLauncher(launcher, userData, fault);
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: undefined },
    });
    const page = await desktop.firstWindow();
    await expect(page.getByTestId('workspace-menu-trigger')).toHaveText(
      'parent',
    );
    await desktop.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1) as { detail?: string };
        (globalThis as { fileErrors?: string }).fileErrors = options.detail;
        return { response: 0, checkboxChecked: false };
      };
    });
    await page
      .locator('.file-tree-row')
      .getByText('Notes', { exact: true })
      .click();
    const current = page
      .locator('.workspace-pane.is-active [contenteditable="true"]')
      .first();
    await current.click();
    await desktop.evaluate(() => {
      (globalThis as { blockWorkspaceWrite?: boolean }).blockWorkspaceWrite =
        true;
    });
    await page.keyboard.press('End');
    await page.keyboard.insertText(' Pending edit');
    const opening = desktop.waitForEvent('window');
    await stubFilePicker(desktop, [source, other]);
    await clickFileMenu(desktop, 'open-file');
    const standalone = await opening;
    await expect(standalone.getByTestId('external-file-editor')).toBeVisible();
    await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
      'parent',
    );
    await expect(current).toContainText('Pending edit');
    await expect
      .poll(() =>
        desktop!.evaluate(
          () => (globalThis as { fileErrors?: string }).fileErrors,
        ),
      )
      .toContain('Diagram.verd');
    const saveError = page.getByTestId('workspace-save-error');
    await expect(saveError).toBeVisible();
    expect(await readFile(notes, 'utf8')).toBe(originalNotes);
    await desktop.evaluate(() => {
      (globalThis as { blockWorkspaceWrite?: boolean }).blockWorkspaceWrite =
        false;
    });
    await closeNativeWindow(desktop, standalone);
    await saveError
      .getByRole('button', { name: /^(重试保存|Retry save)$/ })
      .click();
    await expect.poll(() => readFile(notes, 'utf8')).toContain('Pending edit');
    await expect(saveError).toHaveCount(0);
    await stubFilePicker(desktop, [path.join(directory, 'missing.md'), source]);
    await clickFileMenu(desktop, 'open-file');
    await expect(page.getByTestId('workspace-menu-trigger')).toHaveText(
      'child',
    );
    await expect(activeTabTitle(page)).toHaveText('Diagram');
    await expect(
      page.locator('.workspace-pane.is-active svg[aria-label="Frame canvas"]'),
    ).toBeVisible();
    await expect
      .poll(() =>
        desktop!.evaluate(
          () => (globalThis as { fileErrors?: string }).fileErrors,
        ),
      )
      .toContain('missing.md');
    expect(desktop.windows()).toHaveLength(1);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('confirms managed and recent-file trash and keeps both listings on failure', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-independent-trash-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const profile = path.join(directory, 'profile');
    const quick = path.join(profile, 'quick-edit');
    const managed = path.join(quick, 'Managed.md');
    const outside = path.join(directory, 'Outside.md');
    const launcher = path.join(directory, 'launch.cjs');
    await mkdir(quick, { recursive: true });
    await writeFile(managed, '# Managed\n');
    await writeFile(outside, '# Outside\n');
    await writeDesktopLauncher(launcher, profile);
    desktop = await electron.launch({ args: [launcher] });
    const main = await desktop.firstWindow();
    await quickCreate(main).click();
    const opening = desktop.waitForEvent('window');
    await stubFilePicker(desktop, [outside]);
    await clickFileMenu(desktop, 'open-file');
    await closeNativeWindow(desktop, await opening);
    for (const filename of [managed, outside]) {
      const name = path.basename(filename);
      const row = main.getByRole('button', { name, exact: true });
      const trash = main.getByRole('button', {
        name: `移到废纸篓 ${name}`,
        exact: true,
      });
      await expect(row).toBeVisible();
      await desktop.evaluate(({ dialog, shell }) => {
        dialog.showMessageBox = async () => ({
          response: 0,
          checkboxChecked: false,
        });
        shell.trashItem = async () => {
          throw new Error('test trash unavailable');
        };
      });
      await trash.click();
      await expect(readFile(filename, 'utf8')).resolves.toMatch(/^#/);
      await desktop.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      await trash.click();
      await expect(main.getByRole('alert')).toContainText(
        'test trash unavailable',
      );
      await expect(row).toBeVisible();
      await desktop.evaluate(
        ({ shell }, destination) => {
          shell.trashItem = async (source) => {
            await process
              .getBuiltinModule('node:fs/promises')!
              .rename(source, destination);
          };
        },
        path.join(directory, `trashed-${name}`),
      );
      await trash.click();
      await expect(row).toHaveCount(0);
      await expect(
        readFile(path.join(directory, `trashed-${name}`), 'utf8'),
      ).resolves.toMatch(/^#/);
    }
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a workspace takeover preserves an independent editor when saving fails', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-workspace-takeover-'),
  );
  let desktop: ElectronApplication | undefined;
  const owner = path.join(directory, 'Owner');
  const source = path.join(owner, 'Diagram.verd');
  try {
    await mkdir(owner);
    const original = JSON.stringify({
      format: 'verd-canvas-bundle',
      version: 1,
      rootFileId: 'Original',
      files: [
        JSON.parse(nativeCanvas('Original')),
        nativeDocument('notes', 'Notes', 'Original notes'),
      ],
    });
    await writeFile(source, original);
    const launcher = path.join(directory, 'launch.cjs');
    const fault = path.join(directory, 'faults.cjs');
    await writeFile(
      fault,
      [
        "const {ipcMain} = require('electron');",
        'const register = ipcMain.handle.bind(ipcMain);',
        "ipcMain.handle = (channel, listener) => register(channel, channel === 'file-host:commit' ? (event, handle, request) => { if (globalThis.blockCanvasWrite && request?.writes?.length) throw new Error('Failed to save canvas'); return listener(event, handle, request); } : listener);",
      ].join('\n'),
    );
    await writeDesktopLauncher(
      launcher,
      path.join(directory, 'profile'),
      fault,
    );
    desktop = await electron.launch({
      args: [launcher, source],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: undefined },
    });
    const editor = await desktop.firstWindow();
    await expect(editor.getByTestId('external-file-editor')).toBeVisible();
    await desktop.evaluate(() => {
      (globalThis as { blockCanvasWrite?: boolean }).blockCanvasWrite = true;
    });
    await editor
      .getByRole('navigation', { name: '文件内页面' })
      .getByRole('button', { name: 'Notes' })
      .click();
    const text = editor.locator('[contenteditable="true"]').first();
    await text.click();
    await editor.keyboard.press('ControlOrMeta+End');
    await editor.keyboard.insertText(' Pending edit');
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect(
      editor.locator('.external-file-app__header [role="status"]'),
    ).toHaveText('保存失败');

    const reopening = desktop.waitForEvent('window');
    await clickFileMenu(desktop, 'show-primary-window');
    const main = await reopening;
    await stubFilePicker(desktop, [owner]);
    await main
      .getByTestId('product-home')
      .getByRole('button', { name: '导入工作区', exact: true })
      .click();
    await expect(
      main.getByText(/文件仍有未保存的修改或冲突|文件未能保存/).first(),
    ).toBeVisible();
    expect(desktop.windows()).toHaveLength(2);
    await expect(editor.getByTestId('external-file-editor')).toBeVisible();
    await expect(readFile(source, 'utf8')).resolves.toBe(original);
    await expect(text).toContainText('Pending edit');
    await desktop.evaluate(() => {
      (globalThis as { blockCanvasWrite?: boolean }).blockCanvasWrite = false;
    });
    await editor.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => readFile(source, 'utf8')).toContain('Pending edit');
    const editorClosed = editor.waitForEvent('close');
    await main
      .getByTestId('product-home')
      .getByRole('button', { name: '导入工作区', exact: true })
      .click();
    await editorClosed;
    await expect(main.getByTestId('workspace-menu-trigger')).toContainText(
      'Owner',
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('aligns the sidebar and opens workspace files from each product view', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-sidebar-navigation-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const workspace = path.join(directory, 'workspace');
    await mkdir(path.join(workspace, 'A folder'), { recursive: true });
    const mainCanvas = JSON.parse(nativeCanvas('Main'));
    mainCanvas.frame.children = ['needle-node'];
    mainCanvas.cells['needle-node'] = {
      id: 'needle-node',
      cellType: 'node',
      kind: 'geometry',
      geometry: {
        x: 120,
        y: 120,
        width: 160,
        height: 100,
        outline: 'rectangle',
      },
      content: { label: '画布命中示例' },
    };
    await writeFile(
      path.join(workspace, 'Main.verd'),
      JSON.stringify(mainCanvas),
    );
    await writeFile(
      path.join(workspace, 'A folder/Read.verd-doc.json'),
      JSON.stringify(
        nativeDocument('read', 'Read this document', 'Document body'),
      ),
    );
    await writeFile(path.join(workspace, 'Damaged.verd'), '{');
    await Promise.all(
      Array.from({ length: 18 }, (_, i) =>
        writeFile(
          path.join(workspace, `Reference ${i}.txt`),
          'A plain resource',
        ),
      ),
    );
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'profile'));
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
    });
    const page = await desktop.firstWindow();
    const sidebar = page.locator('.workspace-sidebar');
    const app = sidebar.getByRole('navigation', { name: '应用导航' });
    const workspacePage = sidebar.getByRole('button', {
      name: '工作区',
      exact: true,
    });
    const home = app.getByRole('button', { name: '首页', exact: true });
    const quick = app.getByRole('button', { name: '快速创建', exact: true });
    const actions = [
      home,
      quick,
      workspacePage,
      sidebar.getByRole('button', { name: '搜索', exact: true }),
    ];
    for (const action of actions)
      await expect(action).toHaveCSS('height', '30px');
    const bounds = (await home.boundingBox())!;
    for (const action of actions.slice(1)) {
      const other = (await action.boundingBox())!;
      expect(other.x).toBeCloseTo(bounds.x, 0);
      expect(other.width).toBeCloseTo(bounds.width, 0);
    }

    const row = (id: string) =>
      sidebar.locator(`[data-file-id="${id}"] .file-tree-main`);
    const pane = page.locator('.workspace-pane.is-active');
    const canvas = pane.locator(
      'svg[aria-label="Frame canvas"][data-surface="root"]',
    );
    const document = pane.locator('.document-page');
    const folder = sidebar.locator(
      '[data-entry-path="A folder"] .file-tree-dir-toggle',
    );
    await workspacePage.click();
    await folder.click();
    await row('read').click();
    await expect(activeTabTitle(page)).toHaveText('Read this document');
    await expect(document).toBeVisible();
    await row('Main').click();
    await expect(activeTabTitle(page)).toHaveText('Main');
    await expect(canvas).toBeVisible();

    await home.click();
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('product-home')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+p');
    const search = page.getByTestId('workspace-search-dialog');
    await expect(
      search.getByRole('button', { name: '标题与路径' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await search.getByRole('combobox').fill('Reference 17');
    await expect(search.getByRole('option')).toHaveCount(1);
    await expect(search.getByRole('option')).toContainText('Reference 17.txt');
    await page.keyboard.press('Escape');
    await row('read').click();
    await expect(document).toBeVisible();
    await expect(home).not.toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('ControlOrMeta+Shift+f');
    await search.getByRole('button', { name: '正文', exact: true }).click();
    await search.getByRole('combobox').fill('画布命中');
    const hit = search.getByRole('option', { name: /画布命中/ });
    await expect(hit.getByText('画布命中', { exact: true })).toBeVisible();
    await hit.click();
    await expect(search).toHaveCount(0);
    await expect(
      pane.locator('[data-reveal-cell-id="needle-node"]'),
    ).toBeVisible();
    await expect(activeTabTitle(page)).toHaveText('Main');

    await quick.click();
    await expect(page.getByTestId('quick-create-page')).toBeVisible();
    await row('Main').click();
    await expect(activeTabTitle(page)).toHaveText('Main');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('quick-create-page')).toHaveCount(0);
    await home.click();
    await sidebar
      .locator('[data-failed-path="Damaged.verd"] .file-tree-main')
      .click();
    const error = page.getByTestId('workspace-file-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Damaged.verd');
    await expect(page.getByTestId('product-home')).toHaveCount(0);

    const footer = sidebar.locator('.workspace-sidebar-footer');
    const settings = footer.getByTestId('workspace-my');
    const collapse = footer.getByRole('button', {
      name: '收起侧栏',
      exact: true,
    });
    const wrap = await desktop.browserWindow(page);
    await wrap.evaluate((window) => window.setSize(820, 480));
    const footerBounds = (await footer.boundingBox())!;
    const settingsBounds = (await settings.boundingBox())!;
    expect((await collapse.boundingBox())!.x).toBeGreaterThanOrEqual(
      settingsBounds.x + settingsBounds.width,
    );
    await sidebar
      .locator('[data-entry-path="Reference 17.txt"]')
      .scrollIntoViewIfNeeded();
    expect((await footer.boundingBox())!.y).toBe(footerBounds.y);
    await collapse.focus();
    await collapse.press('Enter');
    const expand = footer.getByRole('button', {
      name: '展开侧栏',
      exact: true,
    });
    await expect(expand).toBeFocused();
    await expect(sidebar).toHaveCSS('width', '44px');
    expect((await footer.boundingBox())!.y).toBe(footerBounds.y);
    const centers = await footer.evaluate((element) => {
      const contentCenter = (node: Element) => {
        const { left, right } = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          (left +
            right +
            parseFloat(style.borderLeftWidth) +
            parseFloat(style.paddingLeft) -
            parseFloat(style.borderRightWidth) -
            parseFloat(style.paddingRight)) /
          2
        );
      };
      return {
        footer: contentCenter(element),
        rail: contentCenter(element.closest('.workspace-sidebar')!),
      };
    });
    const expandCenter = await expand.evaluate((element) => {
      const { left, width } = element.getBoundingClientRect();
      return left + width / 2;
    });
    expect(centers.footer).toBeCloseTo(centers.rail, 1);
    expect(expandCenter).toBeCloseTo(centers.footer, 1);
    await expect(home).toBeVisible();
    await expect(quick).toBeVisible();
    await expand.press('Enter');
    await expect(collapse).toBeFocused();
    expect(desktop.windows()).toHaveLength(1);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
