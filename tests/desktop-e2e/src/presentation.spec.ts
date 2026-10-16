import { _electron as electron, test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { selectDrawingTool } from '../../web-e2e/src/drawing-tools';
import { committedCells, workspaceDigest } from './workspace-disk';

const root = path.resolve(__dirname, '../../..');

test('desktop lectures in the same fullscreen window and one Esc restores the editor', async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-present-e2e-'));
  const userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeFile(
    launcher,
    'const {app} = require("electron");\napp.setPath("userData", ' +
      JSON.stringify(userData) +
      ');\nrequire(' +
      JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js')) +
      ');\n',
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  const desktop = await electron.launch({ args: [launcher], env });
  try {
    const page = await desktop.firstWindow();
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
    await page
      .locator('.frame-app-toolbar:visible')
      .getByRole('button', { name: '撤销', exact: true })
      .click();
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
