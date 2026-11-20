import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';

test('Desktop table edits commit to disk and survive a native close and restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-table-'));
  const workspace = path.join(directory, 'workspace');
  const document = path.join(workspace, 'Table.verd-doc.json');
  await mkdir(workspace);
  const paragraph = (text: string) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
  await writeFile(
    document,
    JSON.stringify({
      format: 'verd-document',
      version: 1,
      id: 'desktop-table',
      title: 'Table',
      text: {
        schemaVersion: 1,
        id: 'desktop-table',
        kind: 'block',
        plainText: 'Header\nBefore',
        content: {
          type: 'doc',
          content: [
            {
              type: 'table',
              content: ['Header', 'Before'].map((text, index) => ({
                type: 'tableRow',
                content: [
                  {
                    type: index === 0 ? 'tableHeader' : 'tableCell',
                    content: [paragraph(text)],
                  },
                ],
              })),
            },
          ],
        },
      },
    }),
  );
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, path.join(directory, 'user-data'));
  const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };
  let desktop: ElectronApplication | undefined;
  try {
    desktop = await electron.launch({ args: [launcher], env });
    let page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Table$/ })
      .click();
    const cell = page.locator('.workspace-pane.is-active .tiptap td p');
    await cell.fill('Persisted');
    await expect(cell).toHaveText('Persisted');
    await expect
      .poll(async () =>
        (await readFile(document, 'utf8')).includes('Persisted'),
      )
      .toBe(true);
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = await electron.launch({ args: [launcher], env });
    page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Table$/ })
      .click();
    await expect(
      page.locator('.workspace-pane.is-active .tiptap td p'),
    ).toHaveText('Persisted');
    await expect(
      page.locator('.workspace-pane.is-active .tiptap table'),
    ).toHaveCount(1);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
