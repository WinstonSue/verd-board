import {
  applyCellOperations,
  createCellRuntime,
  planGeometryLayout,
} from '../../../packages/engine/core/src/cell/index';
import { createWorkspaceCellRegistry } from '../../../packages/workspace/core/src/frames/plugins';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { expect, test, type ElectronApplication } from '@playwright/test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setAppLanguage } from '../../web-e2e/src/app-actions';
import { expandPropertyGroup } from '../../web-e2e/src/property-group';

const root = path.resolve(__dirname, '../../..');
// eslint-disable-next-line no-empty-pattern -- Electron owns the page.
test('one-shot optimized paths persist across desktop restart without enabling continuous calculation', async ({}, info) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-optimized-routing-'),
  );
  const workspace = path.join(directory, 'workspace');
  const filename = path.join(workspace, 'routing.verd');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(workspace);
    await copyFile(
      path.join(
        root,
        'workspace/架构图/细节/01-项目分层与依赖/01.1-完整包分层与依赖.verd',
      ),
      filename,
    );
    const source = JSON.parse(await readFile(filename, 'utf8'));
    // Give all 43 relationships the current 96px layout clearance before testing
    // route-only optimization; the authored diagram has two blocked terminals.
    const registry = createWorkspaceCellRegistry();
    const initial = createCellRuntime(
      {
        store: {
          rootId: source.frame.id,
          cells: { [source.frame.id]: source.frame, ...source.cells },
        },
      },
      registry,
    ).store;
    const plan = planGeometryLayout(
      initial,
      { focus: [initial.rootId], ids: [] },
      'layers',
      registry,
    );
    expect(plan.status).toBe('success');
    const prepared = applyCellOperations(initial, plan.operations, registry);
    const before = {
      ...source,
      frame: prepared.cells[prepared.rootId],
      cells: Object.fromEntries(
        Object.entries(prepared.cells).filter(([id]) => id !== prepared.rootId),
      ),
    };
    const edgeCount = Object.values<{ cellType: string }>(before.cells).filter(
      (cell) => cell.cellType === 'edge',
    ).length;
    // Project diagrams already contain saved paths. Start without them so the
    // persistence wait below cannot succeed before the first optimization saves.
    for (const cell of Object.values(before.cells) as any[])
      if (cell.cellType === 'edge') delete cell.route.points;
    await writeFile(filename, JSON.stringify(before));
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };

    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1440, 900),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      await page.locator('.file-tree-name[title="routing.verd"]').click();
      const pane = page.locator('.workspace-pane.is-active');
      await expect(pane.locator('[data-edge-hit]')).toHaveCount(edgeCount);
      await setAppLanguage(page, 'zh');
      await expandPropertyGroup(pane);
      return { page, pane, button: pane.getByTestId('frame-reroute-edges') };
    };
    const { page, pane, button } = await launch();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toBeEnabled();
    await expect(
      pane.getByTestId('frame-auto-layout-toggle'),
    ).not.toBeChecked();
    await expect(pane.getByTestId('frame-auto-edges-toggle')).not.toBeChecked();
    await expect
      .poll(
        async () =>
          Object.values(
            JSON.parse(await readFile(filename, 'utf8')).cells,
          ).filter(
            (cell: any) =>
              cell.route?.mode === 'orthogonal' && cell.route.points?.length,
          ).length,
      )
      .toBe(edgeCount);
    const saved = JSON.parse(await readFile(filename, 'utf8'));
    for (const cell of Object.values(before.cells) as any[])
      if (cell.cellType === 'node') expect(saved.cells[cell.id]).toEqual(cell);
    await pane.getByRole('button', { name: '选择连线整理方式' }).click();
    await expect(
      page.getByRole('menuitemradio', { name: /^重置手工走线/ }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('routing-options.png') });
    await page.getByRole('menuitemradio', { name: /^重置手工走线/ }).click();
    await expect(button).toHaveText('重置手工走线');
    await expect(button).toBeDisabled();
    await expect
      .poll(
        async () =>
          Object.values(
            JSON.parse(await readFile(filename, 'utf8')).cells,
          ).filter((cell: any) => cell.route?.points?.length).length,
      )
      .toBe(0);
    await pane.getByRole('button', { name: '选择连线整理方式' }).click();
    await page.getByRole('menuitemradio', { name: /^优化全部连线/ }).click();
    await expect
      .poll(async () => JSON.parse(await readFile(filename, 'utf8')).cells)
      .toEqual(saved.cells);
    const closed = page.waitForEvent('close');
    await desktop!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop!.close();
    desktop = undefined;
    const restarted = await launch();
    await expect(restarted.button).toBeEnabled();
    await expect(
      restarted.pane.getByTestId('frame-auto-edges-toggle'),
    ).not.toBeChecked();
    expect(JSON.parse(await readFile(filename, 'utf8')).cells).toEqual(
      saved.cells,
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
