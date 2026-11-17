import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { canvasFiles, seedEmptyCanvas } from './workspace-disk';
import { openActiveFile } from '../../web-e2e/src/app-actions';
import { checkDiagramColors } from '../../helpers/diagram-colors';
import { exerciseStyleColorWorkspace } from '../../helpers/style-color-workspace';
import { styleColorWorkspaceFixture } from '../../fixtures/style-color-workspace';

test('Desktop style edits preserve unrelated containers and switch theme families after reload', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(240_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-style-workspace-'));
  const userData = path.join(directory, 'user-data');
  const workspace = path.join(userData, 'workspaces', 'default');
  await mkdir(workspace, { recursive: true });
  for (const file of styleColorWorkspaceFixture().files)
    await writeFile(
      path.join(workspace, `${file.frame.id}.verd.json`),
      JSON.stringify(file),
    );
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  try {
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await openActiveFile(page);
    await exerciseStyleColorWorkspace(page, info, async () =>
      Object.fromEntries(
        Object.values(await canvasFiles(userData)).map((file) => [
          file.frame.id,
          file,
        ]),
      ),
    );
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Desktop style colors persist and follow custom canvas backgrounds', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(240_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-diagram-colors-'));
  const userData = path.join(directory, 'user-data');
  const workspace = path.join(userData, 'workspaces', 'default');
  await mkdir(userData);
  await seedEmptyCanvas(workspace);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const desktop = await electron.launch({
    args: [launcher],
    env: { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace },
  });
  try {
    const page = await desktop.firstWindow();
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await openActiveFile(page);
    let exportIndex = 0;
    await checkDiagramColors(page, info, async (action) => {
      const target = path.join(directory, `export-${exportIndex++}.svg`);
      await desktop.evaluate(({ session }, target) => {
        (globalThis as any).__diagramDownloadState = null;
        session.defaultSession.once('will-download', (_event, item) => {
          item.setSavePath(target);
          item.once('done', (_event, state) => {
            (globalThis as any).__diagramDownloadState = state;
          });
        });
      }, target);
      await action();
      await expect
        .poll(() =>
          desktop.evaluate(() => (globalThis as any).__diagramDownloadState),
        )
        .toBe('completed');
      return readFile(target);
    });
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
