import { electron, writeDesktopLauncher } from './desktop-launcher';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setAppLanguage } from '../../web-e2e/src/app-actions';

const root = path.resolve(__dirname, '../../..');
// eslint-disable-next-line no-empty-pattern -- Electron owns its window; no browser fixture is needed.
test('package connectors keep canonical routes, show bridges and highlight relationships across desktop restart', async ({}, info) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-connectors-e2e-'));
  const workspace = path.join(directory, 'workspace'),
    userData = path.join(directory, 'user-data');
  let desktop: ElectronApplication | undefined;
  try {
    await cp(path.join(root, 'workspace'), workspace, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(path.join(root, 'workspace'), file)
          .split(path.sep)
          .includes('.verdscrolls'),
    });
    const filename = path.join(
      workspace,
      '架构图/细节/01-项目分层与依赖/01.1-完整包分层与依赖.verd.json',
    );
    const original = await readFile(filename, 'utf8');
    const edgeCount = Object.values<{ cellType: string }>(
      JSON.parse(original).cells,
    ).filter((cell) => cell.cellType === 'edge').length;
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1000),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible()) await skip.click();
      const file = page.locator(
        '.file-tree-name[title="架构图/01-项目分层与依赖.verd.json"]',
      );
      if (!(await file.isVisible()))
        await page.getByRole('button', { name: '架构图', exact: true }).click();
      await file.click();
      await page
        .locator(
          '.workspace-pane.is-active [data-cell-id="project:overview/01/detail/1"] > [data-frame-header] > [data-frame-title-id] > rect',
        )
        .first()
        .click();
      await page
        .locator('.workspace-pane.is-active')
        .getByTestId('frame-open')
        .click();
      const canvas = page.locator(
        '.workspace-pane.is-active svg[aria-label="Frame canvas"][data-surface="root"][data-instance-id="project:detail/01/01"]',
      );
      await expect(
        canvas.locator(
          '[data-edge-hit]:not([data-document-preview-scroll] [data-edge-hit])',
        ),
      ).toHaveCount(edgeCount);
      await setAppLanguage(page, 'zh');
      await page
        .getByTestId('canvas-status-fit')
        .locator('visible=true')
        .click();
      return { page, canvas };
    };
    const { page, canvas } = await launch();
    const paths = await canvas
      .locator(
        '[data-edge-hit]:not([data-document-preview-scroll] [data-edge-hit])',
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('d')),
      );
    expect(
      await canvas
        .locator(
          '[data-edge-display]:not([data-document-preview-scroll] [data-edge-display])',
        )
        .evaluateAll((elements) =>
          elements.some((element) => element.getAttribute('d')?.includes(' A')),
        ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('desktop-package-fit.png') });
    const connector = canvas
      .locator('[data-cell-id="demo:packages/edge/23"]')
      .first();
    const route = (await connector
      .locator(
        '[data-edge-hit]:not([data-document-preview-scroll] [data-edge-hit])',
      )
      .getAttribute('d'))!;
    // Routing may add detours around obstacles. Assert orthogonality rather
    // than a segment count tied to an older layout of the package diagram.
    expect(route).toMatch(/^[ML0-9eE.,\s+-]+$/);
    const coordinates = (
      route.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []
    ).map(Number);
    expect(coordinates.length).toBeGreaterThanOrEqual(4);
    expect(coordinates.length % 2).toBe(0);
    for (let index = 2; index < coordinates.length; index += 2)
      expect(
        coordinates[index] === coordinates[index - 2] ||
          coordinates[index + 1] === coordinates[index - 1],
      ).toBe(true);
    await connector.dispatchEvent('pointerover');
    await expect(
      canvas.locator('[data-relation-highlight="node"]'),
    ).toHaveCount(2);
    await expect(
      canvas.locator('[data-relation-highlight="node"]').first(),
    ).toHaveAttribute('stroke-width', '1.5');
    await expect(
      canvas.locator('[data-relation-highlight="node"]').first(),
    ).not.toHaveAttribute('vector-effect', 'non-scaling-stroke');
    expect(
      await canvas
        .locator('[data-relation-highlight="node"]')
        .first()
        .getAttribute('opacity'),
    ).toBeNull();
    await connector.dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
    await canvas.dispatchEvent('pointerup', { button: 0, pointerId: 1 });
    await expect(
      connector.locator('[data-relation-highlight="edge"]'),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('desktop-package-relationship.png'),
    });
    await connector.dispatchEvent('pointerout');
    const focusNode = canvas
      .locator('[data-cell-id="demo:packages/module/@sue/board-mind"]')
      .first();
    const box = (await focusNode.boundingBox())!;
    await canvas.dispatchEvent('wheel', {
      deltaY: -150,
      deltaMode: 0,
      ctrlKey: true,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
    });
    await expect
      .poll(async () =>
        parseInt(
          (await page
            .getByTestId('canvas-zoom-label')
            .locator('visible=true')
            .textContent())!,
          10,
        ),
      )
      .toBeGreaterThan(80);
    expect(
      parseInt(
        (await page
          .getByTestId('canvas-zoom-label')
          .locator('visible=true')
          .textContent())!,
        10,
      ),
    ).toBeLessThan(120);
    await page.screenshot({
      path: info.outputPath('desktop-package-detail.png'),
    });
    await focusNode.click();
    await connector.dispatchEvent('pointerover');
    const selectedOutline = canvas
      .locator('[data-node-highlight="demo:packages/module/@sue/board-mind"]')
      .first();
    await expect(selectedOutline).toHaveAttribute('stroke-width', '2.5');
    await expect(selectedOutline).not.toHaveAttribute(
      'vector-effect',
      'non-scaling-stroke',
    );
    await expect(
      canvas.locator('[data-relation-highlight="node"]'),
    ).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath('desktop-selection-vs-related.png'),
    });
    const outlineBox = (await selectedOutline.boundingBox())!;
    const canvasBox = (await canvas.boundingBox())!;
    const x = Math.max(canvasBox.x, outlineBox.x - 100);
    const y = Math.max(canvasBox.y, outlineBox.y - 220);
    const right = Math.min(
      canvasBox.x + canvasBox.width,
      outlineBox.x + outlineBox.width + 100,
    );
    const bottom = Math.min(
      canvasBox.y + canvasBox.height,
      outlineBox.y + outlineBox.height + 100,
    );
    await page.screenshot({
      path: info.outputPath('desktop-shadow-detail.png'),
      clip: { x, y, width: right - x, height: bottom - y },
    });
    const clip = { x, y, width: right - x, height: bottom - y };
    await page.mouse.move(0, 0);
    await canvas.dispatchEvent('pointerdown', {
      button: 0,
      pointerId: 10,
      clientX: canvasBox.x + 20,
      clientY: canvasBox.y + 20,
    });
    await canvas.dispatchEvent('pointerup', {
      button: 0,
      pointerId: 10,
      clientX: canvasBox.x + 20,
      clientY: canvasBox.y + 20,
    });
    await expect(canvas.locator('[data-interaction-stroke]')).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('desktop-highlight-normal.png'),
      clip,
    });
    await focusNode.dispatchEvent('pointerover');
    await expect(selectedOutline).toHaveAttribute(
      'data-interaction-stroke',
      'related',
    );
    await expect(selectedOutline).toHaveAttribute('stroke-width', '1.5');
    await page.screenshot({
      path: info.outputPath('desktop-highlight-secondary.png'),
      clip,
    });
    await focusNode.click();
    await expect(selectedOutline).toHaveAttribute(
      'data-interaction-stroke',
      'selected',
    );
    await expect(selectedOutline).toHaveAttribute('stroke-width', '2.5');
    await page.screenshot({
      path: info.outputPath('desktop-highlight-primary.png'),
      clip,
    });
    await page.getByTestId('canvas-status-fit').locator('visible=true').click();
    await connector.dispatchEvent('pointerover');
    await expect(selectedOutline).toHaveAttribute('stroke-width', '2.5');
    await expect(
      canvas.locator('[data-relation-highlight="node"]'),
    ).toHaveAttribute('stroke-width', '1.5');
    await page.screenshot({
      path: info.outputPath('desktop-selection-vs-related-fit.png'),
    });
    await desktop!.close();
    desktop = undefined;
    expect(await readFile(filename, 'utf8')).toBe(original);
    const reopened = await launch();
    expect(
      await reopened.canvas
        .locator(
          '[data-edge-hit]:not([data-document-preview-scroll] [data-edge-hit])',
        )
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('d')),
        ),
    ).toEqual(paths);
    expect(await readFile(filename, 'utf8')).toBe(original);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
