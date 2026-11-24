import { chooseLocalDirectory as chooseDirectory } from './service-actions';
import { test, expect } from './service-fixture';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  openActiveFile,
  openProductHome,
  openWorkspaceMenu,
  selectWorkspaceAction,
} from './app-actions';
import {
  decodeServiceValue,
  encodeServiceValue,
} from '../../../packages/product/app/src/host/service-protocol';
import { createDocumentFile } from '../../../packages/workspace/core/src/documents/document-files';

const modulePath = () =>
  test.info().project.metadata.runtime === 'production'
    ? '/test-support/workspace-host.js'
    : '/@fs' +
      path.resolve(
        __dirname,
        '../../../apps/web/src/test-support/workspace-host.ts',
      );

test('returns from an old Quick Create preference to Home and restores the workspace', async ({
  page,
  localService,
}) => {
  // Let the current app establish its saved workspace and tabs first.
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  const config = path.join(
    localService.dataRoot,
    'verdboard-global-config.json',
  );
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(config, 'utf8').catch(() => '{}')).value
          ?.desktopWorkspace,
    )
    .toBeTruthy();
  const prior = JSON.parse(await fs.readFile(config, 'utf8'));
  await fs.writeFile(
    config,
    JSON.stringify({
      ...prior,
      value: { ...prior.value, productPage: 'quick-create' },
    }),
  );
  await page.reload();
  const home = page.getByTestId('product-home');
  await expect(home).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: /^(应用导航|Application navigation)$/ })
      .getByRole('button'),
  ).toHaveCount(1);
  await page
    .getByRole('navigation', { name: /^(当前工作区|Current workspace)$/ })
    .getByRole('button', { name: /^(工作区|Workspace)$/ })
    .click();
  await expect(home).toHaveCount(0);
  await expect(
    page.getByRole('navigation', { name: /^(当前工作区|Current workspace)$/ }),
  ).toBeVisible();
});

async function enableAgentTools(page: import('@playwright/test').Page) {
  await selectWorkspaceAction(page, '工作区设置');
  await page.getByTestId('settings-nav-workspace.data').click();
  await page
    .getByRole('button', { name: '启用或修复编写工具', exact: true })
    .click();
  await expect(page.getByTestId('workspace-agent-status')).toContainText(
    '已就绪',
  );
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
}

test.describe('local Codex', () => {
  test.use({ useFakeCodex: true });

  test('recovers a lost launch response and applies only the reviewed document change', async ({
    page,
    localService,
  }) => {
    const file = path.join(localService.workspace, 'codex.verd-doc.json');
    const initial = JSON.stringify({
      format: 'verd-document',
      version: 1,
      id: 'codex-document',
      title: 'Codex document',
      text: {
        schemaVersion: 1,
        id: 'codex-document',
        kind: 'block',
        plainText: 'Selected words',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Selected words' }],
            },
          ],
        },
      },
    });
    await fs.writeFile(file, initial);
    await page.goto('/');
    await enableAgentTools(page);
    await openActiveFile(page);
    const editor = page.locator(
      '.workspace-pane.is-active .ProseMirror[contenteditable="true"]',
    );
    await editor.click();
    await editor.press('ControlOrMeta+a');
    await expect(
      page
        .getByRole('toolbar', { name: '文字格式' })
        .getByRole('button', { name: '发起 Agent', exact: true }),
    ).toBeVisible();
    await page
      .locator('.workspace-pane.is-active')
      .getByTestId('document-agent-launch')
      .click();
    const dialog = page.getByTestId('workspace-agent-dialog');
    await expect(
      dialog.getByText('Selected words', { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('textbox', { name: '任务', exact: true })
      .fill('fixture-edit');
    const rpc = '**/api/v1/rpc';
    let responseDropped = false;
    await page.route(rpc, async (route) => {
      const request = decodeServiceValue(route.request().postDataJSON()) as {
        method: string;
        args: [unknown, { type?: string }?];
      };
      if (
        !responseDropped &&
        request.method === 'localAgent' &&
        request.args?.[1]?.type === 'start'
      ) {
        const accepted = await route.fetch();
        if (!accepted.ok()) throw new Error('Agent launch was not accepted');
        responseDropped = true;
        await route.abort();
      } else await route.continue();
    });
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    await expect(
      dialog.getByText('Codex read Selected words', { exact: true }),
    ).toBeVisible();
    expect(responseDropped).toBe(true);
    await page.unroute(rpc);
    const apply = dialog.getByRole('button', { name: '应用改动', exact: true });
    await expect(apply).toBeEnabled();
    expect(await fs.readFile(file, 'utf8')).not.toContain(
      'Reviewed Codex change',
    );
    await apply.click();
    await expect(
      dialog.getByText('改动已应用。', { exact: true }),
    ).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toContain('Reviewed Codex change');
    await dialog
      .getByRole('textbox', { name: '任务', exact: true })
      .fill('fixture-cancel');
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    await expect(
      dialog.getByText('原选区已变化。请重新选择，或移除选区。'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: '移除选区', exact: true }).click();
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    await dialog.getByRole('button', { name: '取消任务', exact: true }).click();
    await expect(
      dialog.getByText('任务已取消。', { exact: true }),
    ).toBeVisible();
  });

  test('applies a reviewed canvas change and rejects a stale proposal', async ({
    page,
    localService,
  }) => {
    const original = await fs.readFile(
      path.resolve(
        __dirname,
        '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
      ),
      'utf8',
    );
    const file = path.join(localService.workspace, 'canvas.verd');
    await fs.writeFile(file, original);
    await page.goto('/');
    await enableAgentTools(page);
    await openActiveFile(page);
    const shape = page
      .locator(
        '.workspace-pane.is-active svg[data-surface="root"] [data-cell-id="shape-request"]',
      )
      .first();
    await shape.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: '发起 Agent', exact: true })
      .click();
    const dialog = page.getByTestId('workspace-agent-dialog');
    await dialog
      .getByRole('textbox', { name: '任务', exact: true })
      .fill('fixture-canvas');
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    await expect(
      dialog.getByText('Codex read shape-request', { exact: true }),
    ).toBeVisible();
    const apply = dialog.getByRole('button', { name: '应用改动', exact: true });
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect(
      dialog.getByText('改动已应用。', { exact: true }),
    ).toBeVisible();
    const saved = await fs.readFile(file, 'utf8');
    expect(saved).toContain('Reviewed canvas change');
    await dialog
      .getByRole('textbox', { name: '任务', exact: true })
      .fill('fixture-canvas-follow-up');
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    await expect(apply).toBeEnabled();
    const external = saved.replace('Reviewed canvas change', 'External change');
    await fs.writeFile(file, external);
    await apply.click();
    await expect(
      dialog.getByText('工作区已变化。请重新生成修改。'),
    ).toBeVisible();
    expect(await fs.readFile(file, 'utf8')).toBe(external);
  });

  test('starts from the canvas toolbar with the active nested source and selection', async ({
    page,
    localService,
  }) => {
    const source = JSON.parse(
      await fs.readFile(
        path.resolve(
          __dirname,
          '../../fixtures/ai-canvas/whiteboard-basic.verd.json',
        ),
        'utf8',
      ),
    );
    await fs.writeFile(
      path.join(localService.workspace, 'source.verd'),
      JSON.stringify(source),
    );
    const reference = {
      id: 'agent-nested-reference',
      kind: 'frame-reference',
      cellType: 'node',
      geometry: { x: 30, y: 30, width: 500, height: 400 },
      data: { targetFrameId: source.frame.id },
    };
    const parent = {
      format: 'verd-frame',
      version: 2,
      frame: {
        ...source.frame,
        id: 'agent-parent',
        name: 'Agent parent',
        children: [reference.id],
        groups: [],
      },
      cells: { [reference.id]: reference },
    };
    await fs.writeFile(
      path.join(localService.workspace, 'parent.verd'),
      JSON.stringify(parent),
    );
    await page.goto('/');
    await page
      .locator('.file-tree-file[data-file-id="agent-parent"] .file-tree-main')
      .click();
    const pane = page.locator('.workspace-pane.is-active');
    const launch = pane.getByTestId('canvas-agent-launch');
    await launch.click();
    const dialog = page.getByTestId('workspace-agent-dialog');
    await expect(dialog.getByText('聚焦范围 · parent.verd')).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    const ref = pane.locator(`[data-cell-id="${reference.id}"]`);
    await ref
      .locator(':scope > [data-frame-contents] > [data-frame-content-plate]')
      .dblclick({ position: { x: 25, y: 90 } });
    const nested = ref.locator('svg[data-surface="nested"]');
    await nested.locator('[data-cell-id="shape-request"]').click();
    await launch.click();
    await expect(dialog.getByText('聚焦范围 · source.verd')).toBeVisible();
    await expect(dialog.getByText('已选元素 1')).toBeVisible();
  });

  test('starts from file tree focus and reviews changes outside the selected folder', async ({
    page,
    localService,
  }) => {
    const folder = '空 文件夹';
    const directory = path.join(localService.workspace, folder);
    await fs.mkdir(directory);
    await fs.writeFile(
      path.join(localService.workspace, 'notes.txt'),
      'Resource',
    );
    const file = path.join(localService.workspace, 'outside.verd-doc.json');
    const initial = JSON.stringify(
      createDocumentFile('outside-folder', 'Outside folder'),
    );
    await fs.writeFile(file, initial);
    await page.goto('/');
    await enableAgentTools(page);
    await page
      .locator('.file-tree-file[data-file-id="outside-folder"] .file-tree-main')
      .click();
    const switcher = await openWorkspaceMenu(page);
    await expect(
      switcher.getByRole('button', { name: '发起 Agent', exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('workspace-menu-trigger')).toBeFocused();
    await expect(page.getByTestId('workspace-menu-trigger')).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    const dialog = page.getByTestId('workspace-agent-dialog');
    const task = dialog.getByRole('textbox', { name: '任务', exact: true });
    await page.getByTestId('workspace-agent-launch').press('Enter');
    await expect(dialog.getByText(/^聚焦范围 · /)).toHaveCount(0);
    await expect(
      dialog.getByText('Codex', { exact: false }).first(),
    ).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();

    const action = page.getByRole('menuitem', {
      name: '发起 Agent',
      exact: true,
    });
    await page
      .getByRole('button', { name: 'notes.txt', exact: true })
      .click({ button: 'right' });
    await action.click();
    await expect(dialog.getByText('聚焦范围 · notes.txt')).toBeVisible();
    await task.fill('Keep this task');
    await dialog.getByRole('button', { name: '清除聚焦范围' }).click();
    await expect(task).toHaveValue('Keep this task');
    await expect(dialog.getByText(/^聚焦范围 · /)).toHaveCount(0);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();

    const row = page.locator(
      `.file-tree-dir[data-entry-path=${JSON.stringify(folder)}]`,
    );
    await row
      .getByRole('button', { name: folder, exact: true })
      .click({ button: 'right' });
    await action.click();
    await expect(dialog.getByText('聚焦范围 · ' + folder)).toBeVisible();
    await task.fill('fixture-folder-edit');
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    const apply = dialog.getByRole('button', { name: '应用改动', exact: true });
    await expect(apply).toBeEnabled();
    expect(await fs.readFile(file, 'utf8')).toBe(initial);
    await apply.click();
    await expect(dialog.getByText('改动已应用。')).toBeVisible();
    expect(JSON.parse(await fs.readFile(file, 'utf8')).text.plainText).toBe(
      'Reviewed cross-folder change',
    );
    expect(await fs.readdir(directory)).toEqual([]);
  });

  test('copies the focused file link for handoff and disables Agent in a readonly workspace', async ({
    context,
    page,
    localService,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await fs.writeFile(
      path.join(localService.workspace, 'copy.verd-doc.json'),
      JSON.stringify(createDocumentFile('agent-copy', 'Copy target')),
    );
    await page.goto('/');
    await openActiveFile(page);
    const launch = page
      .locator('.workspace-pane.is-active')
      .getByTestId('document-agent-launch');
    await launch.press('Enter');
    const dialog = page.getByTestId('workspace-agent-dialog');
    await expect(
      dialog.getByText('聚焦范围 · copy.verd-doc.json'),
    ).toBeVisible();
    await dialog
      .getByRole('textbox', { name: '任务', exact: true })
      .fill('Review the linked page');
    await dialog
      .getByRole('button', { name: '在 Codex 中继续', exact: true })
      .click();
    await dialog.getByRole('button', { name: '复制任务', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('verd://file/agent-copy');

    await page.goto('/?readonly=1');
    await openActiveFile(page);
    await expect(
      page.locator('.workspace-pane.is-active .ProseMirror'),
    ).toHaveAttribute('contenteditable', 'false');
    await expect(launch).toHaveCount(0);
    await expect(page.getByTestId('workspace-agent-launch')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
  });

  test('expires a running task after a service restart and keeps its draft', async ({
    page,
    localService,
  }) => {
    await page.goto('/');
    await enableAgentTools(page);
    await page.getByTestId('workspace-agent-launch').click();
    const dialog = page.getByTestId('workspace-agent-dialog');
    const task = dialog.getByRole('textbox', { name: '任务', exact: true });
    await task.fill('fixture-cancel');
    await dialog.getByRole('button', { name: '快速执行', exact: true }).click();
    const pidFile = path.join(
      localService.workspace,
      '.verdscrolls/codex-fixture.pid',
    );
    await expect
      .poll(() => fs.readFile(pidFile, 'utf8').catch(() => ''))
      .toMatch(/^\d+$/);
    await localService.restart();
    await expect(dialog.getByText('原任务已失效。可重新发起。')).toBeVisible();
    await expect(task).toHaveValue('fixture-cancel');
    await expect(
      dialog.getByRole('button', { name: '快速执行', exact: true }),
    ).toBeEnabled();
  });
});

test('opens a local folder, preserves its files after service restart and exposes a working project CLI', async ({
  page,
  localService,
}) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  const folder = path.join(localService.root, 'opened');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'notes.txt'), 'Local resource');
  await selectWorkspaceAction(page, '导入工作区');
  await chooseDirectory(page, folder);
  await expect(
    page.getByRole('button', { name: 'notes.txt', exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      fs.readFile(path.join(folder, '.verdscrolls/config.json'), 'utf8'),
    )
    .toContain('identity');
  const agent = await page.evaluate(async (entry) => {
    const { createServiceWorkspaceHost } = await import(
      /* @vite-ignore */ entry
    );
    const host = createServiceWorkspaceHost();
    const history = await host.listWorkspaceHistory();
    const handle = await host.openWorkspace({ historyId: history[0].id });
    const before = await host.readSnapshot(handle);
    await host.initializeAgent(handle);
    const snapshot = await host.readSnapshot(handle);
    await host.closeWorkspace(handle);
    host.dispose();
    return { before: before.agent, after: snapshot.agent };
  }, modulePath());
  expect(agent.before?.enabled).toBe(false);
  expect(agent.after?.ready).toBe(true);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const cli = await promisify(execFile)(
    path.join(folder, '.verdscrolls/shared/bin/verd'),
    ['context', '--workspace', folder, '--json'],
  );
  expect(JSON.parse(cli.stdout).name).toBe('opened');
  await localService.restart();
  await page.reload();
  await expect(page.locator('.web-service-bar')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'notes.txt', exact: true }),
  ).toBeVisible();
});

test('backs up browser workspaces, clears the source only after migration and leaves current data intact on backup-file import', async ({
  page,
  localService,
}) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  const original = await page.evaluate(async (entry) => {
    const {
      createBrowserWorkspaceHost,
      exportBrowserBackup,
      encodeServiceValue,
    } = await import(/* @vite-ignore */ entry);
    const browser = createBrowserWorkspaceHost();
    const handle = await browser.openWorkspace({
      default: true,
      name: 'Browser alpha',
    });
    await browser.commit(handle, {
      transactionId: 'migration-ui',
      writes: [
        {
          path: 'original.txt',
          content: new Uint8Array([0, 255, 128]),
          expectedVersion: null,
        },
      ],
    });
    await browser.git(handle, {
      type: 'init',
      author: { name: 'Browser', email: 'browser@example.invalid' },
    });
    const status = (await browser.git(handle, { type: 'status' })).status;
    const commit = await browser.git(handle, {
      type: 'commit',
      message: 'Browser version',
      expectedToken: status.token,
    });
    await browser.openWorkspace({ path: 'beta', name: 'Browser beta' });
    const backup = await exportBrowserBackup();
    return {
      source: JSON.stringify(encodeServiceValue(backup.databases)),
      oid: commit.oid,
    };
  }, modulePath());
  await page.getByTestId('workspace-my').click();
  await page.getByTestId('settings-nav-workspace.data').click();
  await page
    .getByRole('button', { name: '迁移浏览器数据', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: '迁移浏览器数据',
    exact: true,
  });
  await expect(dialog).toContainText('检测到 2 个工作区');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '下载完整备份' }).click();
  const downloaded = await download;
  const backupFile = (await downloaded.path())!;
  const downloadedBackup = decodeServiceValue(
    JSON.parse(await fs.readFile(backupFile, 'utf8')),
  ) as { databases: unknown };
  expect(JSON.stringify(encodeServiceValue(downloadedBackup.databases))).toBe(
    original.source,
  );
  let rejectImport = true;
  await page.route('**/api/v1/rpc', async (route) => {
    const request = decodeServiceValue(route.request().postDataJSON()) as {
      method: string;
    };
    if (rejectImport && request.method === 'importBrowserBackup') {
      rejectImport = false;
      await route.fulfill({
        json: encodeServiceValue({
          error: { message: 'Simulated migration failure' },
        }),
      });
    } else await route.fallback();
  });
  const sourceContents = () =>
    page.evaluate(async (entry) => {
      const { exportBrowserBackup, encodeServiceValue } = await import(
        /* @vite-ignore */ entry
      );
      return JSON.stringify(
        encodeServiceValue((await exportBrowserBackup()).databases),
      );
    }, modulePath());
  await dialog
    .getByRole('button', { name: '选择目标、迁移并清理源数据' })
    .click();
  await chooseDirectory(page, localService.root);
  await expect(dialog.getByRole('alert')).toContainText(
    'Simulated migration failure',
  );
  expect(await sourceContents()).toBe(original.source);
  await dialog
    .getByRole('button', { name: '选择目标、迁移并清理源数据' })
    .click();
  await chooseDirectory(page, localService.root);
  await expect(dialog.getByRole('status')).toContainText('已迁移 2 个工作区', {
    timeout: 30000,
  });
  await expect(dialog.getByRole('status')).toContainText(
    '原 IndexedDB 数据已清理',
  );
  const container = (await fs.readdir(localService.root)).find((name) =>
    name.startsWith('browser-import-'),
  )!;
  const roots = (
    await fs.readdir(path.join(localService.root, container))
  ).filter((name) => !name.startsWith('.'));
  const first = path.join(
    localService.root,
    container,
    roots.find((name) => name.includes('Browser_alpha'))!,
  );
  expect([...(await fs.readFile(path.join(first, 'original.txt')))]).toEqual([
    0, 255, 128,
  ]);
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  expect(
    (
      await promisify(execFile)('git', ['-C', first, 'rev-parse', 'HEAD'])
    ).stdout.trim(),
  ).toBe(original.oid);
  const remaining = await page.evaluate(async (entry) => {
    const { exportBrowserBackup } = await import(/* @vite-ignore */ entry);
    return (await exportBrowserBackup()).databases.flatMap((db: any) =>
      db.stores.flatMap((store: any) => store.records),
    );
  }, modulePath());
  expect(remaining).toEqual([]);
  await page.evaluate(async (entry) => {
    const { createBrowserWorkspaceHost } = await import(
      /* @vite-ignore */ entry
    );
    const host = createBrowserWorkspaceHost();
    await host.openWorkspace({
      path: 'keep-current',
      name: 'Keep current browser data',
    });
  }, modulePath());
  const currentSource = await sourceContents();
  await dialog.getByLabel('导入备份文件').setInputFiles(backupFile);
  await dialog
    .getByRole('button', { name: '选择目标并迁移', exact: true })
    .click();
  await chooseDirectory(page, localService.root);
  await expect(dialog.getByRole('status')).toContainText('已迁移 2 个工作区');
  expect(await sourceContents()).toBe(currentSource);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
});

test('browses, creates and cancels directories and backs up bundled content to the chosen location', async ({
  page,
  localService,
}) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  const picker = page.getByRole('dialog', {
    name: '导入工作区',
    exact: true,
  });
  await selectWorkspaceAction(page, '导入工作区');
  await expect(picker.getByLabel('文件夹路径')).toBeEnabled();
  await picker.getByLabel('新文件夹名称').fill('chosen-parent');
  await picker.getByRole('button', { name: '新建文件夹', exact: true }).click();
  const chosen = path.join(
    await fs.realpath(localService.root),
    'chosen-parent',
  );
  await expect(picker.getByLabel('文件夹路径')).toHaveValue(chosen);
  await picker.getByRole('button', { name: '上一级', exact: true }).click();
  await picker
    .getByRole('button', { name: '📁 chosen-parent', exact: true })
    .click();
  await expect(picker.getByLabel('文件夹路径')).toHaveValue(chosen);
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  expect(
    (await localService.readDisk()).meta.config.value.identity,
  ).toBeTruthy();
  const menu = await openWorkspaceMenu(page);
  await menu.getByRole('button', { name: '新建工作区', exact: true }).click();
  const name = page.getByRole('dialog', { name: '新建工作区', exact: true });
  const nameInput = name.getByLabel('名称', { exact: true });
  const parentInput = name.getByLabel('父目录', { exact: true });
  const chooseParent = name.getByRole('button', {
    name: '选择父目录…',
    exact: true,
  });
  const create = name.getByRole('button', { name: '创建', exact: true });
  await expect(nameInput).toBeFocused();
  await nameInput.fill('Chosen workspace');
  await expect(create).toBeDisabled();
  await chooseParent.click();
  await chooseDirectory(page, chosen);
  await expect(parentInput).toHaveValue(chosen);
  await expect(chooseParent).toBeFocused();
  const destination = path.join(chosen, 'Chosen workspace');
  await expect(fs.stat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
  await chooseParent.click();
  const parentPicker = page.getByRole('dialog', {
    name: '选择本地文件夹',
    exact: true,
  });
  await parentPicker.getByRole('button', { name: '取消', exact: true }).click();
  await expect(nameInput).toHaveValue('Chosen workspace');
  await expect(parentInput).toHaveValue(chosen);
  await expect(chooseParent).toBeFocused();
  await create.click();
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    'Chosen workspace',
  );
  expect(
    (
      await fs.stat(path.join(destination, '.verdscrolls/config.json'))
    ).isFile(),
  ).toBe(true);
  await (
    await openProductHome(page)
  )
    .getByTestId('workspace-open-builtin')
    .click();
  await expect(page.getByTestId('workspace-readonly')).toBeVisible();
  const builtin = path.join(
    localService.dataRoot,
    'workspaces/system-introduction',
  );
  await fs.writeFile(path.join(builtin, 'added.verd'), 'Backup original bytes');
  await selectWorkspaceAction(page, '工作区设置');
  await page.getByTestId('settings-nav-workspace.data').click();
  await page
    .getByTestId('builtin-workspace-settings')
    .getByRole('button', { name: '恢复系统内置内容…', exact: true })
    .click();
  const confirmation = page.getByTestId('workspace-action-confirmation');
  await confirmation
    .getByRole('checkbox', { name: '备份当前工作区', exact: true })
    .check();
  await confirmation
    .getByRole('button', { name: '选择目录并备份更新', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '选择本地文件夹', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  await expect(confirmation).toBeVisible();
  expect(await fs.readFile(path.join(builtin, 'added.verd'), 'utf8')).toBe(
    'Backup original bytes',
  );
  await confirmation
    .getByRole('button', { name: '选择目录并备份更新', exact: true })
    .click();
  await chooseDirectory(page, chosen);
  await expect(confirmation).toHaveCount(0);
  const backups = (await fs.readdir(chosen)).filter((name) =>
    name.startsWith('系统介绍-备份-'),
  );
  expect(backups).toHaveLength(1);
  expect(
    await fs.readFile(path.join(chosen, backups[0], 'added.verd'), 'utf8'),
  ).toBe('Backup original bytes');
  await expect
    .poll(async () =>
      fs.access(path.join(builtin, 'added.verd')).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);
  await selectWorkspaceAction(page, '工作区设置');
  await page.getByTestId('settings-nav-workspace.data').click();
  await page.getByRole('button', { name: '打开备份目录', exact: true }).click();
  await expect
    .poll(() => localService.openedPaths)
    .toContain(path.join(chosen, backups[0]));
});

test('retains pending edits across a service restart and resolves a stale-version conflict', async ({
  page,
  localService,
}) => {
  test.setTimeout(120_000);
  const file = path.join(localService.workspace, 'restart.verd-doc.json');
  const native = {
    format: 'verd-document',
    version: 1,
    id: 'restart-document',
    title: 'Restart document',
    text: {
      schemaVersion: 1,
      id: 'restart-document',
      kind: 'block',
      plainText: 'Original',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Original' }] },
        ],
      },
    },
  };
  await fs.writeFile(file, JSON.stringify(native));
  await page.goto('/');
  await openActiveFile(page);
  let pending:
    { reached: boolean; release(): void; wait: Promise<void> } | undefined;
  const arm = () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = { reached: false, release, wait };
    pending = request;
    return request;
  };
  await page.route('**/api/v1/rpc', async (route) => {
    const request = decodeServiceValue(route.request().postDataJSON()) as {
      method: string;
      args: any[];
    };
    if (
      pending &&
      request.method === 'commit' &&
      request.args[1].writes?.some(
        (write: { path: string }) => write.path === 'restart.verd-doc.json',
      )
    ) {
      const held = pending;
      pending = undefined;
      held.reached = true;
      await held.wait;
    }
    await route.fallback();
  });
  const editor = page.locator(
    '.workspace-pane.is-active .ProseMirror[contenteditable="true"]',
  );
  const first = arm();
  try {
    await editor.click();
    await editor.press('ControlOrMeta+End');
    await page.keyboard.insertText(' retained');
    await expect.poll(() => first.reached).toBe(true);
    await localService.restart();
    await expect(editor).toContainText('Original retained');
    first.release();
    await expect
      .poll(() => fs.readFile(file, 'utf8'))
      .toContain('Original retained');
    await expect(
      page.locator('.workspace-pane.is-active').getByTestId('save-status'),
    ).toHaveAttribute('data-save-state', 'saved');
    const second = arm();
    try {
      await editor.press('ControlOrMeta+End');
      await page.keyboard.insertText(' local');
      await expect.poll(() => second.reached).toBe(true);
      await localService.restart();
      const external = JSON.parse(await fs.readFile(file, 'utf8'));
      external.text.plainText = 'External revision';
      external.text.content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'External revision' }],
          },
        ],
      };
      await fs.writeFile(file, JSON.stringify(external));
      second.release();
      await expect(page.locator('.workspace-conflict-banner')).toBeVisible();
      await expect(editor).toContainText('Original retained local');
      expect(await fs.readFile(file, 'utf8')).toContain('External revision');
      await page
        .locator('[data-action-id="workspace.conflict.keep-local"]')
        .click();
      await expect(page.locator('.workspace-conflict-banner')).toHaveCount(0);
      await expect
        .poll(() => fs.readFile(file, 'utf8'))
        .toContain('Original retained local');
    } finally {
      second.release();
    }
  } finally {
    first.release();
  }
});
