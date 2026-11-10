import {
  openVersionSettings,
  initializeVersions,
  closeVersionSettings,
  openScopedVersions,
} from './version-actions';
import { expect, test, type Page } from './service-fixture';
import path from 'node:path';

const modulePath = () =>
  test.info().project.metadata['runtime'] === 'production'
    ? '/test-support/workspace-host.js'
    : '/@fs' +
      path.resolve(
        __dirname,
        '../../../apps/web/src/test-support/workspace-host.ts',
      );
const active = (page: Page) => page.locator('.workspace-pane.is-active');

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await page.evaluate(async (modulePath) => {
    const { createServiceWorkspaceHost } = await import(
      /* @vite-ignore */ modulePath
    );
    const host = createServiceWorkspaceHost();
    const handle = await host.openWorkspace({ default: true });
    const file = {
      format: 'verd-document',
      version: 1,
      id: 'git-doc',
      title: 'Git note',
      text: {
        schemaVersion: 1,
        id: 'git-doc',
        kind: 'block',
        plainText: 'Before Git',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Before Git' }],
            },
          ],
        },
      },
    };
    const receipt = await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      writes: [
        {
          path: 'Git note.verd-doc.json',
          content: JSON.stringify(file),
          expectedVersion: null,
        },
        {
          path: 'notes.txt',
          content: 'Original plain text',
          expectedVersion: null,
        },
      ],
      session: {
        tabs: [{ fileId: 'git-doc' }],
        activeTabId: 'git-doc',
        activeView: 'file',
        expandedDirs: [],
      },
    });
    if (receipt.outcome !== 'applied')
      throw new Error('Could not seed the Git workspace');
  }, modulePath());
  await page.reload();
  await page
    .locator('.file-tree-name')
    .getByText('Git note', { exact: true })
    .click();
  await expect(active(page).locator('.tiptap')).toContainText('Before Git');
}

test('versions are configured in settings, create manually and restore without creating another version', async ({
  page,
}) => {
  await seed(page);
  await expect(page.getByTestId('workspace-open-git')).toHaveCount(0);
  let settings = await initializeVersions(page);
  await settings
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Baseline');
  await settings
    .getByRole('button', { name: '为全部更改创建版本', exact: true })
    .click();
  await expect(settings.locator('.workspace-git-log article')).toHaveCount(1);
  await closeVersionSettings(page);
  await active(page).locator('.tiptap').fill('After version');
  await expect(active(page).locator('.document-page__save')).toHaveClass(
    /is-saved/,
  );
  settings = await openVersionSettings(page);
  await expect(settings.locator('.workspace-git-log article')).toHaveCount(1);
  await settings
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Edited');
  await settings
    .getByRole('button', { name: '为全部更改创建版本', exact: true })
    .click();
  await expect(settings.locator('.workspace-git-log article')).toHaveCount(2);
  const baseline = settings
    .locator('.workspace-git-log article')
    .filter({ hasText: 'Baseline' });
  await baseline.getByRole('button', { name: '预览', exact: true }).click();
  await expect(settings.getByTestId('git-version-preview')).toContainText(
    'Before Git',
  );
  await baseline
    .getByRole('button', { name: '恢复此版本…', exact: true })
    .click();
  await settings
    .getByRole('region', { name: '恢复预览', exact: true })
    .getByRole('button', { name: '确认恢复', exact: true })
    .click();
  await expect(settings.locator('.workspace-git-log article')).toHaveCount(2);
  await closeVersionSettings(page);
  await expect(active(page).locator('.tiptap')).toContainText('Before Git');
  await page.reload();
  await page
    .locator('.file-tree-name')
    .getByText('Git note', { exact: true })
    .click();
  await expect(active(page).locator('.tiptap')).toContainText('Before Git');
});

test('directory menus expose neutral history that follows a move and restores in the current directory', async ({
  page,
}) => {
  await seed(page);
  await initializeVersions(page);
  await closeVersionSettings(page);
  await page.evaluate(async (modulePath) => {
    const { createServiceWorkspaceHost } = await import(
      /* @vite-ignore */ modulePath
    );
    const host = createServiceWorkspaceHost(),
      handle = await host.openWorkspace({ default: true });
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      mkdirs: ['folder/empty'],
      writes: [
        {
          path: 'folder/note.txt',
          content: 'Directory first',
          expectedVersion: null,
        },
      ],
    });
  }, modulePath());
  await page.reload();
  let dialog = await openScopedVersions(page, 'folder');
  await expect(dialog).not.toContainText('Git');
  await expect(
    dialog.getByRole('button', { name: '为全部更改创建版本', exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Directory first');
  await dialog
    .getByRole('button', { name: '为此目录创建版本', exact: true })
    .click();
  await expect(dialog.locator('.workspace-git-log article')).toHaveCount(1);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(async (modulePath) => {
    const { createServiceWorkspaceHost } = await import(
      /* @vite-ignore */ modulePath
    );
    const host = createServiceWorkspaceHost(),
      handle = await host.openWorkspace({ default: true });
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      moves: [{ from: 'folder', to: 'renamed' }],
    });
    const old = await host.readFile(handle, 'renamed/note.txt');
    await host.commit(handle, {
      transactionId: crypto.randomUUID(),
      writes: [
        {
          path: 'renamed/note.txt',
          content: 'Directory second',
          expectedVersion: old.version,
        },
      ],
    });
  }, modulePath());
  await page.reload();
  dialog = await openScopedVersions(page, 'renamed');
  await expect(dialog.locator('.workspace-git-log article')).toHaveCount(1);
  await dialog
    .getByRole('textbox', { name: '版本说明', exact: true })
    .fill('Directory second');
  await dialog
    .getByRole('button', { name: '为此目录创建版本', exact: true })
    .click();
  const create = dialog.getByRole('region', {
    name: '创建版本预览',
    exact: true,
  });
  await expect(create).toContainText('folder/note.txt');
  await create
    .getByRole('button', { name: '确认创建版本', exact: true })
    .click();
  await expect(dialog.locator('.workspace-git-log article')).toHaveCount(2);
  const first = dialog
    .locator('.workspace-git-log article')
    .filter({ hasText: 'Directory first' });
  await first.getByRole('button', { name: '恢复此版本…', exact: true }).click();
  await dialog
    .getByRole('region', { name: '恢复预览', exact: true })
    .getByRole('button', { name: '确认恢复', exact: true })
    .click();
  await expect(dialog.locator('.workspace-git-log article')).toHaveCount(2);
  expect(
    await page.evaluate(async (modulePath) => {
      const { createServiceWorkspaceHost } = await import(
        /* @vite-ignore */ modulePath
      );
      const host = createServiceWorkspaceHost(),
        handle = await host.openWorkspace({ default: true });
      return new TextDecoder().decode(
        (await host.readFile(handle, 'renamed/note.txt')).content,
      );
    }, modulePath()),
  ).toBe('Directory first');
});
