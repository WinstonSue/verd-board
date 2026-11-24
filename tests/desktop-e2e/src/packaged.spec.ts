import { selectSetting } from '../../helpers/settings-controls';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import type { WorkspaceHistoryEntry } from '../../../packages/workspace/core/src/host/workspace-host';
import {
  openProductHome,
  openWorkspaceMenu,
} from '../../web-e2e/src/app-actions';
import { activeTabTitle } from '../../web-e2e/src/tab-actions';

const appBundle = process.env.VERDBOARD_PACKAGED_APP;
const root = path.resolve(__dirname, '../../..');
test.skip(
  !appBundle || process.platform !== 'darwin',
  'Requires a freshly packaged macOS .app',
);

test('the current package declares Markdown and native canvas file associations', async () => {
  const plist = JSON.parse(
    execFileSync(
      'plutil',
      [
        '-convert',
        'json',
        '-o',
        '-',
        path.join(appBundle!, 'Contents/Info.plist'),
      ],
      { encoding: 'utf8' },
    ),
  );
  const extensions = plist.CFBundleDocumentTypes.flatMap(
    (type: { CFBundleTypeExtensions?: string[] }) =>
      type.CFBundleTypeExtensions ?? [],
  );
  expect(extensions).toEqual(
    expect.arrayContaining(['md', 'markdown', 'verd']),
  );
  expect(extensions).not.toContain('json');
  expect(plist.UTExportedTypeDeclarations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ UTTypeIdentifier: 'com.verdboard.canvas' }),
    ]),
  );
  await access(
    path.join(appBundle!, 'Contents/Resources/default-file-handler'),
  );
});

async function nativeFiles(directory: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.verdscrolls') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(
        ...(await nativeFiles(path.join(directory, entry.name), relative)),
      );
    else if (/\.verd(?:(?:-doc)?\.json)?$/.test(entry.name))
      files.push(relative);
  }
  return files.sort();
}

test('real installed identity opens read-only architecture, restores navigation and recovers old folders', async ({
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-packaged-e2e-'));
  const userData = path.join(directory, 'VerdBoard');
  const workspace = path.join(userData, 'workspaces/default');
  await mkdir(userData, { recursive: true });
  // This recovery scenario uses a profile that already declined the system-default prompt.
  await writeFile(
    path.join(userData, 'file-associations.json'),
    JSON.stringify({ prompted: true }),
  );
  const oldDefault = path.join(directory, 'desktop/workspaces/default');
  const oldContent = JSON.stringify({
    format: 'verd-frame',
    version: 2,
    frame: {
      id: 'old-board',
      cellType: 'frame',
      kind: 'frame',
      children: [],
      groups: [],
    },
    cells: {},
  });
  await mkdir(path.join(oldDefault, '.verdscrolls'), { recursive: true });
  await writeFile(
    path.join(oldDefault, '.verdscrolls/config.json'),
    JSON.stringify({
      version: 1,
      value: { identity: 'packaged-test-project', workspaceInitialized: true },
    }),
  );
  await writeFile(path.join(oldDefault, '旧画布.verd'), oldContent);
  let desktop: ElectronApplication | undefined;
  const env = { ...process.env, VERDBOARD_USER_DATA_PATH: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.VERDBOARD_WORKSPACE_PATH;
  delete env.VERDBOARD_BUILTIN_WORKSPACE_PATH;
  const launch = async () => {
    desktop = await electron.launch({
      executablePath: path.join(appBundle!, 'Contents/MacOS/VerdBoard'),
      env,
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
    expect(
      await desktop.evaluate(({ app }) => ({
        packaged: app.isPackaged,
        name: app.getName(),
        userData: app.getPath('userData'),
      })),
    ).toEqual({ packaged: true, name: 'VerdBoard', userData });
    return page;
  };
  const close = async () => {
    const page = await desktop!.firstWindow();
    const closed = page.waitForEvent('close');
    await desktop!.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop!.close();
    desktop = undefined;
  };
  try {
    let page = await launch();
    await page.getByTestId('workspace-my').click();
    await selectSetting(page.getByTestId('settings-language'), 'zh');
    await page.getByTestId('my-back').click();
    const skip = page.getByRole('button', { name: '跳过', exact: true });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await expect(activeTabTitle(page)).toHaveText('文档导航');
    const expected = await nativeFiles(path.join(root, 'workspace'));
    expect(await nativeFiles(workspace)).toEqual(expected);
    const documents = page
      .locator('.file-tree-dir-toggle')
      .filter({ hasText: /^文档$/ });
    if ((await documents.getAttribute('aria-expanded')) !== 'true')
      await documents.click();
    const architecture = page
      .locator('.file-tree-dir-toggle')
      .filter({ hasText: /^架构$/ });
    if ((await architecture.getAttribute('aria-expanded')) !== 'true')
      await architecture.click();
    await page
      .locator('.file-tree-name')
      .getByText('系统架构', { exact: true })
      .click();
    const active = () => page.locator('.workspace-pane.is-active');
    await expect(activeTabTitle(page)).toHaveText('系统架构');
    await expect(page.getByTestId('workspace-readonly')).toHaveText('只读');
    const editor = active().locator('.ProseMirror');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await editor.click();
    await page.keyboard.type('Packaged app edit attempt');
    await expect(editor).not.toContainText('Packaged app edit attempt');
    await page.screenshot({
      path: info.outputPath(`packaged-architecture-${browserName}.png`),
    });
    await close();
    page = await launch();
    await expect(activeTabTitle(page)).toHaveText('系统架构');
    await expect(page.getByTestId('workspace-readonly')).toBeVisible();
    await expect(active().locator('.ProseMirror')).toHaveAttribute(
      'contenteditable',
      'false',
    );
    const history = await page.evaluate(() =>
      (
        window as unknown as {
          electronAPI: {
            workspaceHost: {
              listWorkspaceHistory(): Promise<WorkspaceHistoryEntry[]>;
            };
          };
        }
      ).electronAPI.workspaceHost.listWorkspaceHistory(),
    );
    const recovered = history.filter(
      (entry) => entry.name === '旧工作区 (desktop)',
    );
    expect(recovered).toHaveLength(1);
    const menu = await openWorkspaceMenu(page);
    await menu.getByTestId(`workspace-history-${recovered[0].id}`).click();
    // The first writable workspace deploys the bundled Agent runtime.
    await expect(page.getByTestId('workspace-menu-trigger')).toHaveText(
      recovered[0].name,
      { timeout: 60000 },
    );
    await expect(
      page.locator('.file-tree-name').getByText('旧画布', { exact: true }),
    ).toBeVisible();
    await (
      await openProductHome(page)
    )
      .getByTestId('workspace-open-builtin')
      .click();
    await expect(activeTabTitle(page)).toHaveText('系统架构');
    await close();
    expect(await readFile(path.join(oldDefault, '旧画布.verd'), 'utf8')).toBe(
      oldContent,
    );
    expect(await nativeFiles(workspace)).toEqual(expected);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('real packaged app preserves an intentionally empty personal workspace at the old default path', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-packaged-empty-'));
  let desktop: ElectronApplication | undefined;
  try {
    const userData = path.join(directory, 'VerdBoard');
    const workspace = path.join(userData, 'workspaces/default');
    await mkdir(userData, { recursive: true });
    // This recovery scenario uses a profile that already declined the system-default prompt.
    await writeFile(
      path.join(userData, 'file-associations.json'),
      JSON.stringify({ prompted: true }),
    );
    await mkdir(path.join(workspace, '.verdscrolls'), { recursive: true });
    await writeFile(
      path.join(workspace, '.verdscrolls/config.json'),
      JSON.stringify({
        version: 1,
        value: {
          identity: 'packaged-test-project',
          workspaceInitialized: true,
        },
      }),
    );
    const env = { ...process.env, VERDBOARD_USER_DATA_PATH: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    delete env.VERDBOARD_WORKSPACE_PATH;
    desktop = await electron.launch({
      executablePath: path.join(appBundle!, 'Contents/MacOS/VerdBoard'),
      env,
    });
    const page = await desktop.firstWindow();
    await expect(page.locator('.workspace-shell')).toBeVisible({
      timeout: 60000,
    });
    expect(await nativeFiles(workspace)).toEqual([]);
    const closed = page.waitForEvent('close');
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await closed;
    await desktop.close();
    desktop = undefined;
    expect(await nativeFiles(workspace)).toEqual([]);
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
