import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setAppLanguage } from '../../web-e2e/src/app-actions';
import {
  createGroup,
  switchGroup,
  deleteGroup,
} from '../../web-e2e/src/tab-actions';

const root = path.resolve(__dirname, '../../..');
test('Desktop restores tab groups and shared documents and saves focused edits when a group closes', async () => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-tab-groups-'));
  const workspace = path.join(directory, 'workspace');
  const userData = path.join(directory, 'user-data');
  let desktop: ElectronApplication | undefined;
  const active = (page: Page) => page.locator('.workspace-pane.is-active');
  try {
    await mkdir(workspace);
    await mkdir(userData);
    const docPath = path.join(workspace, 'Source.verd-doc.json');
    await writeFile(
      docPath,
      JSON.stringify({
        format: 'verd-document',
        version: 1,
        id: 'desktop-tabs-doc',
        title: 'Shared desktop source',
        text: {
          schemaVersion: 1,
          id: 'desktop-tabs-doc',
          kind: 'block',
          plainText: 'Initial body',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Initial body' }],
              },
            ],
          },
        },
      }),
    );
    await writeFile(
      path.join(workspace, 'Canvas.verd.json'),
      JSON.stringify({
        format: 'verd-frame',
        version: 2,
        frame: {
          id: 'desktop-tabs',
          name: 'Desktop tabs',
          kind: 'frame',
          cellType: 'frame',
          geometry: { x: 0, y: 0, width: 800, height: 600 },
          children: ['document'],
          groups: [],
        },
        cells: {
          document: {
            id: 'document',
            kind: 'document-frame',
            cellType: 'node',
            geometry: { x: 20, y: 20, width: 600, height: 500 },
            data: { targetDocumentId: 'desktop-tabs-doc' },
          },
        },
      }),
    );
    const launcher = path.join(directory, 'launch.cjs');
    await writeFile(
      launcher,
      [
        "const {app} = require('electron');",
        `app.setPath('userData', ${JSON.stringify(userData)});`,
        `require(${JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js'))});`,
      ].join('\n'),
    );
    const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await expect(page.locator('.workspace-shell')).toBeVisible();
      return page;
    };
    const close = async (page: Page) => {
      const closed = page.waitForEvent('close');
      await desktop!.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
      await closed;
      await desktop!.close();
      desktop = undefined;
    };
    let page = await launch();
    await page
      .locator('.file-tree-name')
      .getByText('Desktop tabs', { exact: true })
      .click();
    await setAppLanguage(page, 'zh');
    await active(page)
      .getByRole('button', { name: '打开引用详情', exact: true })
      .click();
    await expect(active(page).locator('.document-page__title')).toHaveValue(
      'Shared desktop source',
    );
    const editor = active(page).locator('.ProseMirror[contenteditable="true"]');
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.pressSequentially(' shared edit');
    await createGroup(page, 'Writing');
    await expect(page.locator('.workspace-empty')).toBeVisible();
    await page
      .locator('.file-tree-name')
      .getByText('Shared desktop source', { exact: true })
      .click();
    await expect(active(page).locator('.board-document-content')).toContainText(
      'shared edit',
    );
    await active(page)
      .locator('.document-page__title')
      .fill('Saved group title');
    await deleteGroup(page, 'Writing');
    await expect(active(page).locator('.document-page__title')).toHaveValue(
      'Saved group title',
    );
    await createGroup(page, 'Restored group');
    await page
      .locator('.file-tree-name')
      .getByText('Saved group title', { exact: true })
      .click();
    await close(page);
    page = await launch();
    await expect(page.locator('ylib-tabs').getByRole('tab')).toHaveCount(1);
    await expect(active(page).locator('.document-page__title')).toHaveValue(
      'Saved group title',
    );
    await expect(active(page).locator('.board-document-content')).toContainText(
      'shared edit',
    );
    await switchGroup(page, '默认分组');
    await expect(page.locator('ylib-tabs').getByRole('tab')).toHaveCount(2);
    await deleteGroup(page, 'Restored group');
    await deleteGroup(page, '默认分组');
    await expect(page.locator('.workspace-empty')).toBeVisible();
    await close(page);
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(workspace),
    );
    const savedName = files.find((name) => name.endsWith('.verd-doc.json'))!;
    const saved = JSON.parse(
      await readFile(path.join(workspace, savedName), 'utf8'),
    );
    expect(saved.title).toBe('Saved group title');
    expect(saved.text.plainText).toContain('shared edit');
  } finally {
    // A failing save deliberately prevents the app's normal shutdown. Do not
    // leave the test's private Electron process waiting for user intervention.
    if (desktop) {
      desktop.process().kill('SIGKILL');
      await desktop.close().catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});
