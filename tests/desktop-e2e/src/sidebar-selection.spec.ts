import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { checkSidebarSelection } from '../../web-e2e/src/sidebar-selection-actions';

test('Desktop sidebar replaces folder reveals and multi-selection on ordinary navigation', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-sidebar-selection-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'workspace'),
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await checkSidebarSelection(page, () =>
      desktop!.evaluate(({ clipboard }) => clipboard.readText()),
    );
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
