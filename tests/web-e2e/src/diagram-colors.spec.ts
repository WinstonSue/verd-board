import { test } from './service-fixture';
import { openActiveFile } from './app-actions';
import { checkDiagramColors } from '../../helpers/diagram-colors';
import { exerciseStyleColorWorkspace } from '../../helpers/style-color-workspace';
import { styleColorWorkspaceFixture } from '../../fixtures/style-color-workspace';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { persistedWorkspace } from './workspace-nav';

test('style edits stay isolated from unrelated legacy containers and follow the selected theme', async ({
  page,
  localService,
}, info) => {
  test.setTimeout(240_000);
  for (const file of styleColorWorkspaceFixture().files)
    await writeFile(
      path.join(localService.workspace, `${file.frame.id}.verd`),
      JSON.stringify(file),
    );
  await localService.restart();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await openActiveFile(page);
  await exerciseStyleColorWorkspace(
    page,
    info,
    async () => (await persistedWorkspace(page))!.records,
  );
});

test('diagram colors follow explicit categories and preserve user style families', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await openActiveFile(page);
  await checkDiagramColors(page, info);
});
