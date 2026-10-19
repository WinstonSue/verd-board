import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workspaceDigest } from './workspace-disk';

const root = path.resolve(__dirname, '../../..');

async function close(desktop: ElectronApplication, page: Page) {
  const closed = page.waitForEvent('close');
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].close(),
  );
  await closed;
  await desktop.close();
}

test('Desktop follows system, remembers manual appearance after restart, and leaves workspace files unchanged', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-appearance-e2e-'));
  const userData = path.join(directory, 'user-data');
  const workspace = path.join(userData, 'workspaces', 'default');
  await mkdir(workspace, { recursive: true });
  const doc = {
    format: 'verd-document',
    version: 1,
    id: 'desktop-appearance-doc',
    title: 'Desktop appearance',
    text: {
      schemaVersion: 1,
      id: 'desktop-appearance-doc',
      kind: 'block',
      align: 'left',
      plainText: 'Original body',
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Original body' }],
          },
        ],
      },
    },
  };
  const docPath = path.join(workspace, 'Appearance.verd-doc.json');
  await writeFile(docPath, JSON.stringify(doc));
  const launcher = path.join(directory, 'launch.cjs');
  await writeFile(
    launcher,
    `const {app} = require('electron');\napp.setPath('userData', ${JSON.stringify(userData)});\nrequire(${JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js'))});\n`,
  );
  const env = { ...process.env, VERDBOARD_WORKSPACE_PATH: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  let desktop = await electron.launch({ args: [launcher], env });
  try {
    let page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'dark',
    );
    // A document-only workspace starts without a canvas toolbar.
    await page.locator('.workspace-sidebar-footer button').click();
    await expect(page.getByTestId('settings-appearance')).toHaveValue('system');
    expect(
      await page
        .getByTestId('my-page')
        .evaluate(
          (element) => getComputedStyle(element, '::backdrop').backgroundColor,
        ),
    ).toBe('rgb(15, 23, 42)');
    await page.getByTestId('settings-appearance').selectOption('light');
    expect(
      await page
        .getByTestId('my-page')
        .evaluate(
          (element) => getComputedStyle(element, '::backdrop').backgroundColor,
        ),
    ).toBe('rgb(248, 250, 252)');
    await page.getByTestId('my-back').click();
    await page
      .locator('.file-tree-name')
      .filter({ hasText: /^Desktop appearance$/ })
      .click();
    await expect(
      page.locator('.workspace-pane.is-active .document-page'),
    ).toBeVisible();
    const content = await readFile(docPath, 'utf8');
    const canvases = await workspaceDigest(userData);
    await page.locator('.workspace-sidebar-footer button').click();
    await page.getByTestId('settings-appearance').selectOption('dark');
    await page.getByTestId('my-back').click();
    await close(desktop, page);
    desktop = await electron.launch({ args: [launcher], env });
    page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'dark',
    );
    await page.locator('.workspace-sidebar-footer button').click();
    await expect(page.getByTestId('settings-appearance')).toHaveValue('dark');
    await page.getByTestId('settings-appearance').selectOption('system');
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'light',
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-verd-appearance',
      'dark',
    );
    expect(await readFile(docPath, 'utf8')).toBe(content);
    expect(await workspaceDigest(userData)).toBe(canvases);
  } finally {
    await desktop
      .evaluate(({ BrowserWindow, app }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
        app.exit(0);
      })
      .catch(() => undefined);
    await desktop.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
