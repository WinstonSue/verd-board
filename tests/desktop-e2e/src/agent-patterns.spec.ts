import { electron, writeDesktopLauncher } from './desktop-launcher';
import { openWorkspaceMenu } from '../../web-e2e/src/app-actions';
import { test, expect, type ElectronApplication } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Agent pattern library opens an editable copy and preserves it on subsequent opens', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-patterns-e2e-'));
  const source = path.resolve(
    __dirname,
    '../../../packages/product/agent-patterns/workspace/范式导航.verd-doc.json',
  );
  const original = await readFile(source, 'utf8');
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'user-data');
    await mkdir(userData);
    const launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    desktop = await electron.launch({
      args: [launcher],
      env: {
        ...process.env,
        VERDBOARD_WORKSPACE_PATH: path.join(directory, 'initial'),
      },
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible();
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-patterns').click();
    await expect(page.getByRole('tab', { selected: true })).toContainText(
      'Agent 范式库',
    );
    await expect(
      page.locator('.workspace-pane.is-active .board-document-content h1'),
    ).toHaveText('Agent 范式库');
    const copied = path.join(
      userData,
      'workspaces/agent-patterns/范式导航.verd-doc.json',
    );
    const local = JSON.parse(await readFile(copied, 'utf8'));
    local.title = '本地范式副本';
    await writeFile(copied, JSON.stringify(local, null, 2));
    await expect(page.getByRole('tab', { selected: true })).toContainText(
      '本地范式副本',
    );
    await openWorkspaceMenu(page);
    await page.getByTestId('workspace-open-patterns').click();
    expect(JSON.parse(await readFile(copied, 'utf8')).title).toBe(
      '本地范式副本',
    );
    expect(await readFile(source, 'utf8')).toBe(original);
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = undefined;
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
