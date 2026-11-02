import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import { exerciseDocumentResources } from '../../web-e2e/src/document-resource-actions';
test('Desktop reads local PDF with packaged worker and preserves attachment references', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-rich-e2e-'));
  const userData = path.join(directory, 'user-data');
  await mkdir(userData);
  const launcher = path.join(directory, 'launch.cjs');
  await writeDesktopLauncher(launcher, userData);
  const desktop = await electron.launch({
    args: [launcher],
    env: {
      ...process.env,
      VERDBOARD_WORKSPACE_PATH: path.join(userData, 'workspaces', 'default'),
    },
  });
  try {
    const page = await desktop.firstWindow();
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text());
    });
    page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
    await expect(
      page.locator(
        'input[accept=".json,.verd.json,.verd-doc.json,.md,.markdown"]',
      ),
    ).toBeAttached({ timeout: 45000 });
    await exerciseDocumentResources(page);
    const remoteDenied = await desktop.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0].webContents.mainFrame.frames
        .length;
    });
    expect(remoteDenied).toBe(0);
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
