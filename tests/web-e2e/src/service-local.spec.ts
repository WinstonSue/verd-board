import { chooseLocalDirectory as chooseDirectory } from './service-actions';
import { test, expect } from './service-fixture';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  openActiveFile,
  openWorkspaceMenu,
  selectWorkspaceAction,
} from './app-actions';
import {
  decodeServiceValue,
  encodeServiceValue,
} from '../../../packages/product/app/src/host/service-protocol';

const modulePath = () =>
  test.info().project.metadata.runtime === 'production'
    ? '/test-support/workspace-host.js'
    : '/@fs' +
      path.resolve(
        __dirname,
        '../../../apps/web/src/test-support/workspace-host.ts',
      );

test('opens a local folder, preserves its files after service restart and exposes a working project CLI', async ({
  page,
  localService,
}) => {
  await page.goto('/');
  await expect(page.locator('.workspace-shell')).toBeVisible();
  const folder = path.join(localService.root, 'opened');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'notes.txt'), 'Local resource');
  await selectWorkspaceAction(page, '打开工作区文件夹');
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
    const snapshot = await host.readSnapshot(handle);
    await host.closeWorkspace(handle);
    host.dispose();
    return snapshot.agent;
  }, modulePath());
  expect(agent?.ready).toBe(true);
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
    name: '选择本地文件夹',
    exact: true,
  });
  await selectWorkspaceAction(page, '打开工作区文件夹');
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
  await name.getByRole('textbox').fill('Chosen workspace');
  await name.getByRole('button', { name: '创建', exact: true }).click();
  await chooseDirectory(page, chosen);
  await expect(page.getByTestId('workspace-menu-trigger')).toContainText(
    'Chosen workspace',
  );
  expect(
    (
      await fs.stat(
        path.join(chosen, 'Chosen workspace/.verdscrolls/config.json'),
      )
    ).isFile(),
  ).toBe(true);
  await selectWorkspaceAction(page, '打开系统介绍');
  await fs.writeFile(
    path.join(localService.workspace, 'added.verd.json'),
    'Backup original bytes',
  );
  await selectWorkspaceAction(page, '工作区设置');
  await page.getByTestId('settings-nav-workspace.data').click();
  await page
    .getByTestId('builtin-workspace-settings')
    .getByRole('button', { name: '更新为系统内置内容…', exact: true })
    .click();
  const confirmation = page.getByTestId('workspace-action-confirmation');
  await confirmation
    .getByRole('checkbox', { name: '备份当前工作区', exact: true })
    .check();
  await confirmation
    .getByRole('button', { name: '选择目录并备份更新', exact: true })
    .click();
  await picker.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeVisible();
  expect(
    await fs.readFile(
      path.join(localService.workspace, 'added.verd.json'),
      'utf8',
    ),
  ).toBe('Backup original bytes');
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
    await fs.readFile(path.join(chosen, backups[0], 'added.verd.json'), 'utf8'),
  ).toBe('Backup original bytes');
  await expect
    .poll(async () =>
      fs.access(path.join(localService.workspace, 'added.verd.json')).then(
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
