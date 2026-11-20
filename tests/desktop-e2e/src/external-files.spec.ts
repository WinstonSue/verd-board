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
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { activeTabTitle } from '../../web-e2e/src/tab-actions';

async function closeNativeWindow(desktop: ElectronApplication, page: Page) {
  const closed = page.waitForEvent('close');
  const window = await desktop.browserWindow(page);
  await window.evaluate((window) => window.close());
  await closed;
}

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
    await desktop.evaluate(
      ({ app }, filename) =>
        app.emit('open-file', { preventDefault() {} }, filename),
      legacy,
    );
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
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
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
    await desktop.evaluate(({ app }) => app.quit());
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
