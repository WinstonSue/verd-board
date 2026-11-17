import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { exerciseDocumentTables } from '../../web-e2e/src/document-table-actions';

test('Desktop tables expose contextual structure controls and preserve edits', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-table-'));
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
    await exerciseDocumentTables(page);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
