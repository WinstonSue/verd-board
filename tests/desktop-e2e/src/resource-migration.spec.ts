import { expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import {
  openWorkspaceMenu,
  setAppLanguage,
} from '../../web-e2e/src/app-actions';
import {
  seedResourceMigration,
  expectResourceMigration,
  expectMigrationUI,
} from '../../helpers/resource-migration';

test('Desktop switches into merged resources and reopens with readable attachments and history', async ({
  browserName: _browserName,
}, info) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'verd-resource-migration-'),
  );
  let desktop: ElectronApplication | undefined;
  try {
    const target = path.join(directory, 'migration-target');
    const before = await seedResourceMigration(target);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
    const env = {
      ...process.env,
      VERDBOARD_WORKSPACE_PATH: path.join(directory, 'initial'),
    };
    desktop = await electron.launch({ args: [launcher], env });
    let page = await desktop.firstWindow();
    await setAppLanguage(page, 'zh');
    await expect(page.getByTestId('workspace-menu-trigger')).not.toContainText(
      'Migrated resources',
    );
    await desktop.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selected],
      });
    }, target);
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-folder').click();
    await expectMigrationUI(page);
    await expectResourceMigration(target, before);
    await desktop.close();
    desktop = undefined;
    delete (env as NodeJS.ProcessEnv).VERDBOARD_WORKSPACE_PATH;
    desktop = await electron.launch({ args: [launcher], env });
    page = await desktop.firstWindow();
    await expectMigrationUI(page);
    await expectResourceMigration(target, before);
    await page.screenshot({
      path: info.outputPath('resource-migration-desktop.png'),
    });
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
