import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openActiveFile } from '../../web-e2e/src/app-actions';
import {
  exerciseMindSummaryRange,
  mindSummaryFixture,
} from '../../helpers/mind-summary';

test('Desktop summary range dragging survives selection raising, history and restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-summary-'));
  let desktop: ElectronApplication | undefined;
  try {
    const workspace = path.join(directory, 'workspace');
    await mkdir(workspace);
    const file = path.join(workspace, 'summary.verd');
    await writeFile(file, JSON.stringify(mindSummaryFixture()));
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const launch = async () => {
      desktop = await electron.launch({
        args: [launcher],
        env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
      });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      await openActiveFile(page);
      return page;
    };
    const page = await launch();
    const readCells = async () =>
      JSON.parse(await readFile(file, 'utf8')).cells;
    await exerciseMindSummaryRange(page, readCells);
    await expect(
      page.locator('.workspace-pane.is-active').getByTestId('save-status'),
    ).toHaveAttribute('data-save-state', 'saved');
    const saved = await readCells();
    await desktop!.close();
    desktop = undefined;
    const restarted = await launch();
    await expect(
      restarted.locator('[data-mind-summary-bracket]:visible'),
    ).toHaveCount(1);
    expect(await readCells()).toEqual(saved);
    expect(saved['summary-range'].data.startSiblingId).toBe('topic-b');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
