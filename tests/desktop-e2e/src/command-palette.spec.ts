import { electron, writeDesktopLauncher } from './desktop-launcher';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

test('Desktop reload routes body keys to workspace and focused keys to the canvas', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-palette-e2e-'));
  const userData = path.join(directory, 'user-data');
  const workspace = path.join(userData, 'workspaces', 'default');
  await mkdir(workspace, { recursive: true });
  const file = path.join(workspace, 'Palette.verd.json');
  await writeFile(
    file,
    await readFile(
      path.join(root, 'tests/fixtures/ai-canvas/whiteboard-basic.verd.json'),
    ),
  );
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

  const desktop = await electron.launch({ args: [launcher], env });
  try {
    const page = await desktop.firstWindow();
    const canvas = page.locator(
      '.workspace-pane.is-active svg[data-surface="root"]',
    );
    const palette = page.getByRole('dialog', {
      name: /^(命令面板|Command palette)$/,
    });
    await expect(page.locator('.workspace-shell')).toBeVisible();
    const content = await readFile(file, 'utf8');
    for (const modifier of ['Control', 'Meta']) {
      await page.reload();
      await expect(page.locator('.workspace-shell')).toBeVisible();
      await expect(page.locator('body')).toBeFocused();
      await page.keyboard.press(`${modifier}+Shift+p`);
      await expect(palette).toHaveCount(1);
      await expect(palette.getByRole('combobox')).toBeFocused();
      await expect(
        palette.locator('[data-action-id="workspace.create-canvas"]'),
      ).toHaveCount(1);
      await expect(
        palette.locator('[data-action-id="canvas.selection.delete"]'),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.locator('body')).toBeFocused();
    }
    await page.locator('[data-file-id="canvas-basic"] .file-tree-name').click();
    await expect(canvas).toBeVisible();
    await canvas.focus();
    await page.keyboard.press('ControlOrMeta+Shift+p');
    await expect(palette).toHaveCount(1);
    await expect(
      palette.locator('[data-action-id="canvas.selection.delete"]'),
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(canvas).toBeFocused();
    expect(await readFile(file, 'utf8')).toBe(content);
  } finally {
    await desktop
      .evaluate(({ BrowserWindow, app }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
        app.exit(0);
      })
      .catch(() => undefined);
    await desktop.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
