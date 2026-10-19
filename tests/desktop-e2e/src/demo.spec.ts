import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
} from '@playwright/test';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  openWorkspaceMenu,
  setAppLanguage,
} from '../../web-e2e/src/app-actions';
import { canvasFiles } from './workspace-disk';

const root = path.resolve(__dirname, '../../..');
const nativeFiles = async (
  dir: string,
  prefix = '',
): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.verdboard') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      Object.assign(
        files,
        await nativeFiles(path.join(dir, entry.name), relative),
      );
    else if (/\.verd(?:-doc)?\.json$/.test(entry.name))
      files[relative] = await readFile(path.join(dir, entry.name), 'utf8');
  }
  return files;
};

test('built-in native workspace opens its diagrams and documents, follows links and preserves edits across an upgrade', async ({
  browserName,
}, info) => {
  test.setTimeout(120_000);
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-builtin-e2e-'));
  const userData = path.join(directory, 'user-data');
  const source = path.join(directory, 'builtin-source');
  const workspace = path.join(userData, 'workspaces', 'default');
  let desktop: ElectronApplication | undefined;
  try {
    await mkdir(userData);
    await cp(path.join(root, 'workspace'), source, {
      recursive: true,
      filter: (file) =>
        !path
          .relative(path.join(root, 'workspace'), file)
          .split(path.sep)
          .includes('.verdboard'),
    });
    const original = await nativeFiles(source);
    const launcher = path.join(directory, 'launch.cjs');
    await writeFile(
      launcher,
      [
        "const {app} = require('electron');",
        `app.setPath('userData', ${JSON.stringify(userData)});`,
        `require(${JSON.stringify(path.join(root, 'apps/desktop/dist-electron/main.js'))});`,
      ].join('\n'),
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    delete env.VERDBOARD_WORKSPACE_PATH;
    env.VERDBOARD_BUILTIN_WORKSPACE_PATH = source;
    const launch = async () => {
      desktop = await electron.launch({ args: [launcher], env });
      const page = await desktop.firstWindow();
      await desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1600, 1100),
      );
      await expect(page.locator('.workspace-shell')).toBeVisible();
      if (await page.locator('svg[data-surface="root"]:visible').count())
        await setAppLanguage(page, 'zh');
      const skip = page.getByRole('button', { name: '跳过', exact: true });
      if (await skip.isVisible().catch(() => false)) await skip.click();
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
    let page = await launch();
    const active = () => page.locator('.workspace-pane.is-active');
    const canvas = () =>
      active()
        .locator('svg[aria-label="Frame canvas"][data-surface="root"]')
        .first();
    await expect(canvas()).toBeVisible();
    await expect(
      canvas().locator('[data-cell-kind="frame-reference"]'),
    ).toHaveCount(8);
    await expect(
      canvas().locator('[data-cell-kind="document-frame"]'),
    ).toHaveCount(3);
    expect(Object.keys(await canvasFiles(userData))).toHaveLength(9);
    expect(Object.keys(await nativeFiles(workspace))).toHaveLength(
      Object.keys(original).length,
    );
    await openWorkspaceMenu(page);
    await expect(page.getByTestId('workspace-open-builtin')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: info.outputPath(`builtin-${browserName}-overview.png`),
    });

    await page
      .locator('.file-tree-name')
      .getByText('文档导航', { exact: true })
      .click();
    await expect(active().locator('.document-page__title')).toHaveValue(
      '文档导航',
    );
    await page.screenshot({
      path: info.outputPath(`builtin-${browserName}-documents.png`),
    });
    await active()
      .getByRole('link', { name: '系统架构', exact: true })
      .click({ modifiers: ['ControlOrMeta'] });
    await expect(active().locator('.document-page__title')).toHaveValue(
      '系统架构',
    );
    await expect(active().locator('.board-document-content')).toContainText(
      'WorkspaceSession',
    );
    await page
      .locator('.file-tree-name')
      .getByText('文档导航', { exact: true })
      .click();
    const editor = active().locator('.board-document-content');
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await editor.press('Enter');
    await editor.pressSequentially('Builtin document edit survives upgrades.');
    await expect(editor).toContainText(
      'Builtin document edit survives upgrades.',
    );
    await close();

    const docPath = Object.keys(original).find(
      (file) => JSON.parse(original[file]).id === 'project-doc:README',
    )!;
    const saved = JSON.parse(
      await readFile(path.join(workspace, docPath), 'utf8'),
    );
    expect(saved.text.plainText).toContain(
      'Builtin document edit survives upgrades.',
    );
    expect(await nativeFiles(source)).toEqual(original);
    // A newer resource is available on the next launch. The user's copy wins.
    const newer = JSON.parse(original[docPath]);
    newer.title = 'A newer bundled title';
    await writeFile(path.join(source, docPath), JSON.stringify(newer));
    page = await launch();
    await expect(active().locator('.document-page__title')).toHaveValue(
      '文档导航',
    );
    await expect(active().locator('.board-document-content')).toContainText(
      'Builtin document edit survives upgrades.',
    );
    await close();
    expect(
      JSON.parse(await readFile(path.join(workspace, docPath), 'utf8')),
    ).toEqual(saved);
    expect(
      await readFile(
        path.join(userData, 'verdboard-global-config.json'),
        'utf8',
      ),
    ).toContain('desktopWorkspace');
  } finally {
    await desktop?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
