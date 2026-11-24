import { createHash } from 'node:crypto';
import { cellBodyPoint } from '../../helpers/port-controls';
import { test, expect } from '@playwright/test';
import { electron, writeDesktopLauncher } from './desktop-launcher';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  openProductHome,
  openWorkspaceMenu,
} from '../../web-e2e/src/app-actions';
import { activeTabTitle } from '../../web-e2e/src/tab-actions';

for (const kind of ['project', 'agent-patterns'] as const) {
  test(`${kind} update is opt-in and replaces everything after backing up`, async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'verd-builtin-update-e2e-'),
    );
    const userData = path.join(directory, 'data'),
      launcher = path.join(directory, 'launch.cjs');
    await writeDesktopLauncher(launcher, userData);
    const env = { ...process.env };
    delete env.VERDBOARD_WORKSPACE_PATH;
    const desktop = await electron.launch({ args: [launcher], env });
    try {
      const page = await desktop.firstWindow();
      await expect(page.locator('.workspace-shell')).toBeVisible({
        timeout: 60000,
      });
      if (kind === 'agent-patterns') {
        await (
          await openProductHome(page)
        )
          .getByTestId('workspace-open-patterns')
          .click();
      }
      const root = path.join(
        userData,
        'workspaces',
        kind === 'project' ? 'default' : kind,
      );
      await expect
        .poll(() =>
          readFile(path.join(root, '.verdscrolls/config.json'), 'utf8').then(
            () => true,
            () => false,
          ),
        )
        .toBe(true);
      const before = JSON.parse(
        await readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
      );
      const entryId =
        kind === 'project' ? 'project-doc:README' : 'pattern-library:index';
      const entryTitle = kind === 'project' ? '文档导航' : '文档编写推荐库';
      await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
        'data-tab-id',
        entryId,
      );
      await expect(activeTabTitle(page)).toHaveText(entryTitle);
      await expect(page.getByTestId('workspace-readonly')).toHaveText('只读');
      await expect(
        page.locator('.workspace-pane.is-active .ProseMirror'),
      ).toHaveAttribute('contenteditable', 'false');
      expect(before.value.project.entryDocumentIds[0]).toBe(entryId);
      if (kind === 'project') {
        const alias = path.join(directory, 'system-alias');
        await symlink(root, alias, 'junction');
        const ipc = await page.evaluate(async (path) => {
          const host = (window as any).electronAPI.workspaceHost;
          const throughAlias = await host.openWorkspace({ path });
          const receipt = await host.commit(
            { ...throughAlias, readonly: false },
            {
              transactionId: 'read-only-write',
              writes: [
                {
                  path: 'blocked.txt',
                  content: 'blocked',
                  expectedVersion: null,
                },
              ],
            },
          );
          return { readonly: throughAlias.readonly, outcome: receipt.outcome };
        }, alias);
        expect(ipc).toEqual({ readonly: true, outcome: 'rejected' });
        await expect(
          readFile(path.join(root, 'blocked.txt')),
        ).rejects.toThrow();
        await expect(
          page.locator('.file-tree-name[title="文档导航.verd-doc.json"]'),
        ).toBeVisible();
        await expect(
          page.locator('.file-tree-name[title="Documentation.verd-doc.json"]'),
        ).toBeVisible();
        await page.screenshot({
          path: test.info().outputPath('document-home.png'),
        });

        await page
          .locator('.workspace-pane.is-active')
          .getByRole('link', { name: '项目导览（画布）', exact: true })
          .click({ modifiers: ['ControlOrMeta'] });
        await expect(
          page.locator(
            '.workspace-pane.is-active svg[data-surface="root"][data-instance-id="board-root"]',
          ),
        ).toBeVisible();
        await page.screenshot({
          path: test.info().outputPath('diagram-overview.png'),
        });
        const canvas = () =>
          page
            .locator('.workspace-pane.is-active svg[data-surface="root"]')
            .first();
        for (const name of ['topic', 'detail']) {
          await expect(
            canvas().locator(
              '[data-cell-kind="document-frame"], [data-cell-kind="document-reference"]',
            ),
          ).toHaveCount(0);
          const header = canvas()
            .locator('[data-frame-header] [data-frame-title-id]')
            .first();
          const box = (await header.boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.keyboard.down('Control');
          await page.mouse.wheel(0, -200);
          await page.keyboard.up('Control');
          await expect
            .poll(async () => (await header.boundingBox())!.height)
            .toBeGreaterThan(box.height * 2);
          const point = await cellBodyPoint(header);
          await page.mouse.click(point.x, point.y);
          await page
            .locator('.workspace-pane.is-active')
            .getByTestId('frame-open')
            .click();
          await expect(
            page.locator('.workspace-pane.is-active'),
          ).toHaveAttribute('data-pane-entrance', 'complete');
          await page.screenshot({
            path: test.info().outputPath('diagram-' + name + '.png'),
          });
        }
        await expect(
          canvas().locator('[data-cell-kind="document-reference"]'),
        ).toHaveCount(0);
        await canvas()
          .getByRole('link', {
            name: '系统架构 · 包职责与公共接入',
            exact: true,
          })
          .click({ modifiers: ['ControlOrMeta'] });
        await expect(activeTabTitle(page)).toHaveText('系统架构');
        await expect(
          page
            .locator('.workspace-pane.is-active')
            .getByRole('heading', { name: '包职责与公共接入', exact: true }),
        ).toBeInViewport();
        await page
          .locator('.workspace-pane.is-active')
          .getByTestId('navigation-return')
          .click();
        await page
          .locator('.file-tree-name[title="文档导航.verd-doc.json"]')
          .click();

        await expect(activeTabTitle(page)).toHaveText(entryTitle);
        await desktop.evaluate(
          ({ app }, file) => {
            app.emit('open-file', { preventDefault() {} }, file);
          },
          path.join(root, '架构图/项目导览.verd'),
        );
        await expect(activeTabTitle(page)).toHaveText('项目导览');
        await expect(page.getByTestId('workspace-readonly')).toBeVisible();
        expect(desktop.windows()).toHaveLength(1);
      }
      await writeFile(path.join(root, 'added.txt'), 'my addition');
      await openWorkspaceMenu(page);
      await page.getByTestId('workspace-open-settings').click();
      await page.getByTestId('settings-nav-workspace.data').click();
      await expect(
        page.getByTestId('builtin-workspace-settings'),
      ).toBeVisible();
      await page
        .getByRole('button', { name: /(?:更新为|恢复)系统内置内容…/ })
        .click();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      expect(await readFile(path.join(root, 'added.txt'), 'utf8')).toBe(
        'my addition',
      );
      await page
        .getByRole('button', { name: /(?:更新为|恢复)系统内置内容…/ })
        .click();
      const backupParent = path.join(directory, 'chosen-backups');
      await mkdir(backupParent, { recursive: true });
      await desktop.evaluate(({ dialog }, parent) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [parent],
        });
      }, backupParent);
      await expect(
        page.getByRole('checkbox', { name: '备份当前工作区' }),
      ).not.toBeChecked();
      await page.getByRole('checkbox', { name: '备份当前工作区' }).check();
      await desktop.evaluate(({ dialog }) => {
        const state = globalThis as typeof globalThis & {
          verdBuiltinBackupCancelledCalls: number;
        };
        state.verdBuiltinBackupCancelledCalls = 0;
        dialog.showOpenDialog = async () => {
          state.verdBuiltinBackupCancelledCalls++;
          return { canceled: true, filePaths: [] };
        };
      });
      await page.getByRole('button', { name: '选择目录并备份更新' }).click();
      await expect
        .poll(() =>
          desktop.evaluate(
            () =>
              (
                globalThis as typeof globalThis & {
                  verdBuiltinBackupCancelledCalls: number;
                }
              ).verdBuiltinBackupCancelledCalls,
          ),
        )
        .toBe(1);
      await expect(
        page.getByRole('button', { name: '选择目录并备份更新' }),
      ).toBeEnabled();
      await expect(
        page.getByTestId('workspace-action-confirmation'),
      ).toBeVisible();
      expect(await readFile(path.join(root, 'added.txt'), 'utf8')).toBe(
        'my addition',
      );
      await desktop.evaluate(({ dialog }, parent) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [parent],
        });
      }, backupParent);
      await page.getByRole('button', { name: '选择目录并备份更新' }).click();
      await expect(page.getByTestId('workspace-settings-page')).not.toBeVisible(
        {
          timeout: 60000,
        },
      );
      await expect
        .poll(
          async () =>
            JSON.parse(
              await readFile(
                path.join(root, '.verdscrolls/config.json'),
                'utf8',
              ),
            ).version,
        )
        .toBe(before.version + 1);
      expect(
        JSON.parse(
          await readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
        ).value.identity,
      ).toBe(before.value.identity);
      await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
        'data-tab-id',
        entryId,
      );
      await expect(activeTabTitle(page)).toHaveText(entryTitle);
      await expect(page.getByRole('tab')).toHaveCount(1);
      const backups = path.join(directory, 'chosen-backups');
      const entries = await readdir(backups);
      expect(
        await readFile(path.join(backups, entries[0], 'added.txt'), 'utf8'),
      ).toBe('my addition');
      const history: { id: string; name: string }[] = await page.evaluate(() =>
        (window as any).electronAPI.workspaceHost.listWorkspaceHistory(),
      );
      const backupId = createHash('sha256')
        .update(await realpath(path.join(backups, entries[0])))
        .digest('hex');
      const copy = history.find((entry) => entry.id === backupId)!;
      expect(copy).toBeTruthy();
      await page.getByTestId('workspace-menu-trigger').click();
      const backupRow = page
        .getByTestId('workspace-switcher')
        .getByTestId(`workspace-history-${copy.id}`);
      await expect(backupRow).toContainText(copy.name);
      await backupRow.click();
      await expect(page.getByTestId('workspace-switcher')).not.toBeVisible();
      await expect(page.getByTestId('workspace-menu-trigger')).toBeEnabled();
      await openWorkspaceMenu(page);
      await page.getByTestId('workspace-open-settings').click();
      await page.getByTestId('settings-nav-workspace.data').click();
      await expect(page.getByTestId('builtin-workspace-settings')).toHaveCount(
        0,
      );
    } finally {
      await desktop.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test('first open resets a legacy canvas-first copy without creating a backup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'verd-legacy-builtin-'));
  const userData = path.join(directory, 'data');
  const root = path.join(userData, 'workspaces/default');
  const source = path.resolve(__dirname, '../../../workspace');
  const launcher = path.join(directory, 'launch.cjs');
  await cp(source, root, {
    recursive: true,
    filter: (file) =>
      !path
        .relative(source, file)
        .split(path.sep)
        .some((part) => part.startsWith('.')),
  });
  await rename(
    path.join(root, '文档导航.verd-doc.json'),
    path.join(root, '文档/文档导航.verd-doc.json'),
  );
  await rename(
    path.join(root, 'Documentation.verd-doc.json'),
    path.join(root, '文档/Documentation.verd-doc.json'),
  );
  await rename(
    path.join(root, '架构图/项目导览.verd'),
    path.join(root, '项目导览.verd'),
  );
  const overview = JSON.parse(
    await readFile(path.join(root, '项目导览.verd'), 'utf8'),
  );
  for (const [index, targetDocumentId] of [
    'project-doc:README',
    'project-doc:architecture/ARCHITECTURE',
    'project-doc:development/README',
  ].entries()) {
    const id = 'legacy-document-' + index;
    overview.frame.children.push(id);
    overview.cells[id] = {
      id,
      kind: 'document-frame',
      cellType: 'node',
      geometry: { x: index * 1010, y: 3200, width: 940, height: 640 },
      data: { targetDocumentId },
    };
  }
  const legacyCanvas = JSON.stringify(overview, null, 2) + '\n';
  await writeFile(path.join(root, '项目导览.verd'), legacyCanvas);
  await writeFile(path.join(root, 'my-notes.txt'), 'preserve my old copy');
  await mkdir(path.join(root, '.verdboard'));
  const identity = 'legacy-builtin-e2e-project';
  await writeFile(
    path.join(root, '.verdboard/config.json'),
    JSON.stringify({
      version: 1,
      value: { identity },
    }),
  );
  await writeFile(
    path.join(root, '.verdboard/session.json'),
    JSON.stringify({
      format: 'verd-workspace-session',
      version: 1,
      tabs: [{ fileId: 'board-root' }],
      activeTabId: 'board-root',
      expandedDirs: [],
    }),
  );
  await writeDesktopLauncher(launcher, userData);
  const env = { ...process.env };
  delete env.VERDBOARD_WORKSPACE_PATH;
  const desktop = await electron.launch({ args: [launcher], env });
  try {
    const page = await desktop.firstWindow();
    const home = page.getByTestId('product-home');
    await expect(page.locator('.workspace-shell').or(home)).toBeVisible();
    if (await home.isVisible())
      await home.getByTestId('workspace-open-builtin').click();
    await expect(page.getByTestId('workspace-readonly')).toBeVisible();
    await expect(activeTabTitle(page)).toHaveText('文档导航', {
      timeout: 60000,
    });
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute(
      'data-tab-id',
      'project-doc:README',
    );
    await expect(
      page.getByTestId('workspace-management-page'),
    ).not.toBeVisible();
    for (const oldPath of [
      '项目导览.verd',
      '文档/文档导航.verd-doc.json',
      '文档/Documentation.verd-doc.json',
      'my-notes.txt',
    ]) {
      await expect(readFile(path.join(root, oldPath))).rejects.toThrow();
    }
    expect(
      JSON.parse(
        await readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
      ).value.identity,
    ).toBe(identity);
    const currentCanvas = JSON.parse(
      await readFile(path.join(root, '架构图/项目导览.verd'), 'utf8'),
    );
    expect(
      Object.values(currentCanvas.cells).some(
        (cell: any) =>
          cell.kind === 'document-frame' || cell.kind === 'document-reference',
      ),
    ).toBe(false);
    await expect(
      readdir(path.join(userData, 'workspace-backups')),
    ).rejects.toThrow();
    expect(
      (await readdir(path.dirname(root))).filter((name) =>
        name.startsWith('default.previous-'),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath('legacy-updated-document-home.png'),
    });
  } finally {
    await desktop.close();
    await rm(directory, { recursive: true, force: true });
  }
});
