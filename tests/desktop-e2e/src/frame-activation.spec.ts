import { electron, writeDesktopLauncher } from './desktop-launcher';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setAppLanguage } from '../../web-e2e/src/app-actions';

const root = path.resolve(__dirname, '../../..');
test('Desktop activates only one Frame across every chart type and releases it on exit', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-frame-activation-'),
  );
  const workspace = path.join(directory, 'workspace');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(workspace);
    const refs = [];
    const originals = new Map<string, string>();
    for (const [index, name] of [
      'whiteboard-basic',
      'mind-map',
      'workflow-dag',
      'architecture',
      'uml-class',
      'uml-sequence',
    ].entries()) {
      const bytes = await readFile(
        path.join(root, 'tests/fixtures/ai-canvas', `${name}.verd.json`),
        'utf8',
      );
      const file = JSON.parse(bytes);
      const filename = path.join(workspace, `${name}.verd.json`);
      await writeFile(filename, bytes);
      originals.set(filename, bytes);
      refs.push({
        id: `ref-${index}`,
        kind: 'frame-reference',
        cellType: 'node',
        geometry: {
          x: (index % 3) * 600,
          y: Math.floor(index / 3) * 450,
          width: 560,
          height: 400,
        },
        data: { targetFrameId: file.frame.id },
      });
    }
    await writeFile(
      path.join(workspace, 'Guide.verd.json'),
      JSON.stringify({
        format: 'verd-frame',
        version: 2,
        frame: {
          id: 'guide',
          name: 'Activation guide',
          kind: 'frame',
          cellType: 'frame',
          geometry: { x: 0, y: 0, width: 1800, height: 900 },
          children: refs.map((ref) => ref.id),
          groups: [],
        },
        cells: Object.fromEntries(refs.map((ref) => [ref.id, ref])),
      }),
    );
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({
      args: [launcher],
      env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
    });
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Activation guide$/ })
      .click();
    await setAppLanguage(page, 'zh');
    const canvas = page.locator(
      '.workspace-pane.is-active svg[data-surface="root"]',
    );
    await page.getByTestId('canvas-status-fit').locator('visible=true').click();
    await expect(canvas.locator('[data-reference-preview]')).toHaveCount(6);
    await expect(
      canvas.locator('[data-reference-preview] [data-frame-content-id]'),
    ).toHaveCount(6);
    await expect(canvas.locator('svg[data-surface="nested"]')).toHaveCount(0);
    for (const reference of refs) {
      const shell = canvas.locator(`[data-cell-id="${reference.id}"]`);
      await shell
        .locator(':scope > [data-frame-contents] > [data-frame-content-plate]')
        .dblclick({ position: { x: 20, y: 60 } });
      await expect(shell.locator('svg[data-surface="nested"]')).toHaveCount(1);
      await expect(canvas.locator('svg[data-surface="nested"]')).toHaveCount(1);
    }
    await canvas.locator('svg[data-surface="nested"]').press('Escape');
    await expect(canvas.locator('svg[data-surface="nested"]')).toHaveCount(0);
    await expect(canvas).toBeFocused();
    for (const [filename, bytes] of originals)
      expect(await readFile(filename, 'utf8')).toBe(bytes);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
