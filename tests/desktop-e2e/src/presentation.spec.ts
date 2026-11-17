import { selectHistoryAction } from '../../web-e2e/src/app-actions';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectDrawingTool } from '../../web-e2e/src/drawing-tools';
import {
  committedCells,
  seedEmptyCanvas,
  workspaceDigest,
} from './workspace-disk';
import { openActiveFile } from '../../web-e2e/src/app-actions';

test('desktop lectures in the same fullscreen window and one Esc restores the editor', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-present-e2e-'));
  const userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  env.VERDBOARD_WORKSPACE_PATH = path.join(userData, 'workspaces', 'default');
  await seedEmptyCanvas(env.VERDBOARD_WORKSPACE_PATH);
  const desktop = await electron.launch({ args: [launcher], env });
  try {
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await openActiveFile(page);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1400, 900),
    );
    const canvasSelector =
      'svg[aria-label="Frame canvas"][data-surface="root"]:visible';
    const canvas = page
      .locator('.workspace-pane.is-active')
      .locator(canvasSelector);
    await expect(canvas).toBeVisible();
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible()) await skip.click();
    await selectDrawingTool(page, '形状');
    await page.getByTestId('shape-rectangle').click();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.45);
    await selectDrawingTool(page, '选择');
    await expect(canvas.locator('[data-cell-kind="geometry"]')).toHaveCount(1);
    await page.getByTestId('canvas-zoom-in').locator('visible=true').click();
    await expect
      .poll(
        async () =>
          (await committedCells(userData)).filter(
            (cell) => cell.kind === 'geometry',
          ).length,
      )
      .toBe(1);
    await expect(
      page.getByTestId('save-status').locator('visible=true'),
    ).toHaveAttribute('data-save-state', 'saved');
    const before = await workspaceDigest(userData);
    const camera = (await canvas
      .locator('> [data-frame-world]')
      .getAttribute('transform'))!;
    await canvas.evaluate((svg) =>
      svg.setAttribute('data-lecture-editor-instance', 'original'),
    );
    expect(
      await desktop.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    const extraWindows: string[] = [];
    desktop.on('window', (window) => extraWindows.push(window.url()));

    await page
      .locator('.frame-app-toolbar:visible')
      .getByRole('button', { name: '演示', exact: true })
      .click();
    const mode = page.getByTestId('presentation-mode');
    const lecture = mode.locator(canvasSelector);
    await expect(mode).toBeVisible();
    await expect(lecture).toBeVisible();
    await expect(page.getByTestId('presentation-hud')).toBeVisible();
    await expect
      .poll(() =>
        mode.evaluate((overlay) => {
          const button = document.querySelector(
            '.workspace-pane.is-active .frame-app-toolbar button',
          )!;
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return !!hit && overlay.contains(hit);
        }),
      )
      .toBe(true);
    await expect(page.getByTestId('presentation-step')).toHaveCount(0);
    await expect(
      page
        .getByTestId('presentation-hud')
        .getByRole('button', { name: '退出', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.presentation-panel')).toHaveCount(0);
    await expect
      .poll(() =>
        mode.evaluate(
          (element) => !!document.fullscreenElement?.contains(element),
        ),
      )
      .toBe(true);
    await expect(lecture.locator('[data-cell-kind="geometry"]')).toHaveCount(1);
    if (process.platform === 'darwin') {
      await expect
        .poll(() =>
          desktop.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].isSimpleFullScreen(),
          ),
        )
        .toBe(true);
    }
    await page.keyboard.press('l');
    await expect(mode).toHaveClass(/\bis-laser\b/);
    await page.keyboard.press('l');
    await expect(mode).not.toHaveClass(/\bis-laser\b/);
    for (const key of [
      'Delete',
      'Backspace',
      'ControlOrMeta+z',
      'ControlOrMeta+v',
    ])
      await page.keyboard.press(key);
    await expect(lecture.locator('[data-cell-kind="geometry"]')).toHaveCount(1);
    expect(
      await desktop.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);

    await page.keyboard.press('Escape');
    await expect(mode).toHaveCount(0);
    await expect(page.getByTestId('presentation-hud')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    await expect(canvas).toBeVisible();
    if (process.platform === 'darwin') {
      expect(
        await desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isSimpleFullScreen(),
        ),
      ).toBe(false);
    }
    await expect(canvas).toHaveAttribute(
      'data-lecture-editor-instance',
      'original',
    );
    await expect(canvas.locator('> [data-frame-world]')).toHaveAttribute(
      'transform',
      camera,
    );
    expect(await workspaceDigest(userData)).toBe(before);
    expect(extraWindows).toEqual([]);
    expect(
      await desktop.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    if (process.platform === 'darwin') {
      // A fullscreen window owned by the user must survive presentation cleanup.
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSimpleFullScreen(true),
      );
      await page
        .locator('.frame-app-toolbar:visible')
        .getByRole('button', { name: '演示', exact: true })
        .click();
      await expect(mode).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => !!document.fullscreenElement))
        .toBe(true);
      await page.keyboard.press('Escape');
      await expect(mode).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement === null))
        .toBe(true);
      expect(
        await desktop.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isSimpleFullScreen(),
        ),
      ).toBe(true);
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSimpleFullScreen(false),
      );
    }
    await selectHistoryAction(page, '撤销');
    await expect(canvas.locator('[data-cell-kind="geometry"]')).toHaveCount(0);
  } finally {
    // Window close is deferred while a workspace flush is in progress.
    await desktop
      .evaluate(({ BrowserWindow, app }) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.destroy();
        }
        app.exit(0);
      })
      .catch(() => undefined);
    await desktop.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test('internal links keep canvas and document targets in the same presentation', async () => {
  const { writeFile, readFile } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-present-links-'));
  const root = path.join(directory, 'project');
  await mkdir(root, { recursive: true });
  const link = (file: string) => 'verd://file/' + encodeURIComponent(file);
  const document = (
    id: string,
    title: string,
    label: string,
    href: string,
  ) => ({
    format: 'verd-document',
    version: 1,
    id,
    title,
    text: {
      id,
      kind: 'block',
      schemaVersion: 1,
      plainText: label,
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: '阅读章节' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: label,
                marks: [{ type: 'link', attrs: { href } }],
              },
            ],
          },
        ],
      },
    },
  });
  const board = (id: string, documentId: string) => ({
    format: 'verd-frame',
    version: 2,
    frame: {
      id,
      kind: 'frame',
      cellType: 'frame',
      name: id,
      geometry: { x: 0, y: 0, width: 1200, height: 800 },
      children: [id + '-doc'],
      groups: [],
    },
    cells: {
      [id + '-doc']: {
        id: id + '-doc',
        kind: 'document-frame',
        cellType: 'node',
        geometry: { x: 100, y: 100, width: 700, height: 400 },
        data: { targetDocumentId: documentId },
      },
    },
  });
  const fixtures = {
    'A.verd.json': board('A', 'a-links'),
    'B.verd.json': board('B', 'b-links'),
    'a-links.verd-doc.json': document(
      'a-links',
      'A links',
      '下一画布',
      link('B'),
    ),
    'b-links.verd-doc.json': document(
      'b-links',
      'B links',
      '打开阅读',
      link('reading') + '#阅读章节',
    ),
    'reading.verd-doc.json': document(
      'reading',
      '阅读文档',
      '回到画布',
      link('A'),
    ),
  };
  for (const [name, value] of Object.entries(fixtures))
    await writeFile(path.join(root, name), JSON.stringify(value));
  const before = await Promise.all(
    Object.keys(fixtures).map((name) =>
      readFile(path.join(root, name), 'utf8'),
    ),
  );
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, path.join(directory, 'data'));
  const desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: root },
  });
  try {
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page.locator('.file-tree-name[title="A.verd.json"]').click();
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible()) await skip.click();
    await page
      .locator('.frame-app-toolbar:visible')
      .getByRole('button', { name: '演示', exact: true })
      .click();
    const mode = page.getByTestId('presentation-mode');
    await expect(mode).toBeVisible();
    await mode.getByRole('link', { name: '下一画布', exact: true }).click();
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      'B',
    );
    await expect(mode).toBeVisible();
    await mode.getByRole('link', { name: '打开阅读', exact: true }).click();
    await expect(
      mode.getByRole('heading', { name: '阅读章节' }),
    ).toBeInViewport();
    await expect(mode.locator('[contenteditable=true]')).toHaveCount(0);
    const outline = mode.getByRole('complementary', { name: '目录' });
    await outline.getByRole('button', { name: '隐藏目录' }).click();
    await expect(
      outline.getByRole('button', { name: '显示目录' }),
    ).toBeFocused();
    await outline.getByRole('button', { name: '显示目录' }).click();
    const editor = mode.locator('.tiptap');
    const readingText = await editor.innerText();
    const heading = mode.getByRole('heading', { name: '阅读章节' });
    const text = await heading.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const { left, right, top, height } = range.getBoundingClientRect();
      return { left, right, y: top + height / 2 };
    });
    await page.mouse.move(text.left + 1, text.y);
    await page.mouse.down();
    await page.mouse.move(text.right - 1, text.y, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('阅读章节');
    await editor.focus();
    await page.keyboard.type('@');
    await expect(
      mode.getByRole('listbox', { name: '引用文档与图表' }),
    ).toBeHidden();
    await expect(editor).toHaveText(readingText, { useInnerText: true });
    await expect(
      mode.getByRole('toolbar', { name: 'document', exact: true }),
    ).not.toBeVisible();
    await mode.getByRole('button', { name: '返回来源', exact: true }).click();
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      'B',
    );
    await expect(mode).toBeVisible();
    await mode.getByRole('link', { name: '打开阅读', exact: true }).click();
    await mode.getByRole('link', { name: '回到画布', exact: true }).click();
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      'A',
    );
    await expect(mode).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(mode).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === null))
      .toBe(true);
    expect(
      await Promise.all(
        Object.keys(fixtures).map((name) =>
          readFile(path.join(root, name), 'utf8'),
        ),
      ),
    ).toEqual(before);
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('desktop document enters presentation directly and preserves the draft on exit', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-document-present-'),
  );
  const userData = path.join(directory, 'user-data');
  const workspace = path.join(userData, 'workspaces', 'default');
  await mkdir(userData);
  await seedEmptyCanvas(workspace);
  await writeFile(
    path.join(workspace, 'note.verd-doc.json'),
    JSON.stringify({
      format: 'verd-document',
      version: 1,
      id: 'presentation-note',
      title: 'Presentation note',
      text: {
        schemaVersion: 1,
        kind: 'block',
        id: 'presentation-note',
        plainText: 'Document body',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Document body' }],
            },
          ],
        },
      },
    }),
  );
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  try {
    const page = await desktop.firstWindow();
    await page
      .locator('.file-tree-name')
      .getByText('Presentation note', { exact: true })
      .click();
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      'presentation-note',
    );
    await expect(page.locator('.workspace-content')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    const editor = page.locator('.workspace-pane.is-active .ProseMirror');
    let expected = 'Document body';
    for (const addition of [
      ' preserved draft',
      ' another edit',
      ' latest edit',
    ]) {
      expected += addition;
      await editor.click();
      await expect(editor).toBeFocused();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type(addition);
      await expect(editor).toContainText(expected);
      await page
        .locator('.workspace-pane.is-active')
        .getByRole('toolbar', { name: 'document', exact: true })
        .getByRole('button', { name: '演示', exact: true })
        .click();
      const mode = page.getByTestId('presentation-mode');
      try {
        await expect(mode).toBeVisible();
      } catch (error) {
        const info = test.info();
        await info.attach('document-presentation-state', {
          body: JSON.stringify(
            await page.evaluate(() => {
              const element = document.querySelector(
                '.workspace-pane.is-active .ProseMirror',
              );
              const editor = (element as any)?.editor;
              return {
                text: document.body.innerText,
                active: document.activeElement?.outerHTML,
                fullscreen: document.fullscreenElement?.className,
                focused: editor?.isFocused,
                editable: editor?.isEditable,
                selection: editor?.state.selection.toJSON(),
                content: editor?.getJSON(),
              };
            }),
            null,
            2,
          ),
          contentType: 'application/json',
        });
        const trace = info.outputPath('document-presentation-electron.zip');
        await desktop.context().tracing.stop({ path: trace });
        await info.attach('document-presentation-electron', {
          path: trace,
          contentType: 'application/zip',
        });
        throw error;
      }
      await expect(mode.locator('.ProseMirror')).toHaveAttribute(
        'contenteditable',
        'false',
      );
      await expect(mode).toContainText(expected);
      await expect
        .poll(() =>
          desktop.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
          ),
        )
        .toBe(1);
      await page.keyboard.press('Escape');
      await expect(mode).toHaveCount(0);
      await expect(editor).toHaveAttribute('contenteditable', 'true');
      await expect(editor).toContainText(expected);
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement === null))
        .toBe(true);
    }
    await expect(
      page
        .locator('.workspace-pane.is-active .workspace-file-navigation')
        .getByTestId('save-status'),
    ).toHaveCount(1);
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
