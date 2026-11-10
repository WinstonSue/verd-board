import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openActiveFile } from '../../web-e2e/src/app-actions';
import {
  geometryFixture,
  exerciseJointLayout,
  assertPaintedGap,
} from '../../helpers/geometry-layout';

// eslint-disable-next-line no-empty-pattern -- Electron owns its window.
test('Desktop joint geometry commits safe shared-port paths once and reloads them', async ({}) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-geometry-layout-'));
  let desktop: ElectronApplication | undefined;
  try {
    const project = path.join(directory, 'project'),
      userData = path.join(directory, 'profile');
    await mkdir(project);
    await mkdir(userData);
    const file = path.join(project, 'geometry.verd.json'),
      launcher = path.join(directory, 'launch.cjs');
    await writeFile(file, JSON.stringify(geometryFixture()));
    await writeDesktopLauncher(launcher, userData);
    const launch = async () => {
      desktop = await electron.launch({
        args: [launcher],
        env: { ...process.env, VERDBOARD_WORKSPACE_PATH: project },
      });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1000),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible()) await skip.click();
      await openActiveFile(page);
      return page;
    };
    const page = await launch(),
      saved = async () => JSON.parse(await readFile(file, 'utf8')).cells;
    const arranged = await exerciseJointLayout(page, saved);
    await desktop!.close();
    desktop = undefined;
    const restarted = await launch();
    await expect(restarted.locator('[data-edge-hit]')).toHaveCount(8);
    expect(await saved()).toEqual(arranged);
    assertPaintedGap(await saved());
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
