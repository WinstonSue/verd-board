import path from 'node:path';
import { test, expect } from './service-fixture';
import { openWorkspaceMenu, setAppLanguage } from './app-actions';
import { chooseLocalDirectory } from './service-actions';
import {
  seedResourceMigration,
  expectResourceMigration,
  expectMigrationUI,
} from '../../helpers/resource-migration';

test('service switches into merged resources and reopens with readable attachments and history', async ({
  page,
  localService,
}, info) => {
  const target = path.join(localService.root, 'migration-target');
  const before = await seedResourceMigration(target);
  await page.goto('/');
  await setAppLanguage(page, 'zh');
  await expect(page.getByTestId('workspace-menu-trigger')).not.toContainText(
    'Migrated resources',
  );
  await openWorkspaceMenu(page);
  await page.getByTestId('workspace-open-folder').click();
  await chooseLocalDirectory(page, target);
  await expectMigrationUI(page);
  await expectResourceMigration(target, before);
  await localService.restart();
  await page.reload();
  await expectMigrationUI(page);
  await expectResourceMigration(target, before);
  await page.screenshot({
    path: info.outputPath('resource-migration-web.png'),
  });
});
