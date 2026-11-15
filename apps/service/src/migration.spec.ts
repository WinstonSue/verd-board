import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { IDBFactory } from 'fake-indexeddb';
import { createWebWorkspaceHost } from '../../../packages/product/app/src/host/web-workspace-host';
import { exportBrowserBackup } from '../../../packages/product/app/src/host/browser-backup';
import { encodeServiceValue } from '../../../packages/product/app/src/host/service-protocol';
import { folderIdentityWrite } from '../../../packages/workspace/core/src/host/folder-identity';
import { createServiceWorkspaceHost } from '../../../packages/product/app/src/host/service-workspace-host';
import { createLocalService } from './service';

const exec = promisify(execFile);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-migration-test-'));
  const dataRoot = path.join(root, 'data');
  const service = await createLocalService({
    dataRoot,
    defaultRoot: path.join(root, 'default'),
    builtinSource: path.resolve('../../workspace'),
    patternSource: path.resolve('../../packages/agent/patterns/workspace'),
    productVersion: '2.0.1',
  });
  const port = await service.listen(0);
  const target = createServiceWorkspaceHost({
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
  });
  cleanups.push(async () => {
    target.dispose();
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const factory = new IDBFactory();
  const source = createWebWorkspaceHost({
    indexedDB: factory,
    broadcast: { postMessage() {} } as unknown as BroadcastChannel,
  });
  const handle = (await source.openWorkspace({
    default: true,
    name: '原工作区',
  }))!;
  const config = (await source.readSnapshot(handle)).config;
  await source.commit(handle, {
    transactionId: 'browser-seed',
    config: {
      value: { ...config.value, custom: { kept: true } },
      expectedVersion: config.version,
    },
    mkdirs: ['empty', 'deleted'],
    writes: [
      { path: 'notes.txt', content: 'Original', expectedVersion: null },
      { path: 'normal.lock', content: 'ordinary file', expectedVersion: null },
      {
        path: '.agents/skills/custom/SKILL.md',
        content: '---\nname: custom\ndescription: Custom\n---\nContent',
        expectedVersion: null,
      },
      { path: 'deleted/old.txt', content: 'Recover me', expectedVersion: null },
    ],
    resourceWrites: [
      {
        path: 'assets/binary.dat',
        content: new Uint8Array([0, 255, 10, 128]),
        expectedVersion: null,
      },
    ],
    session: {
      tabs: [],
      activeTabId: null,
      expandedDirs: ['empty'],
      activeView: 'all',
      groups: [{ id: 'g', name: 'Group', tabs: [], activeTabId: null }],
      activeGroupId: 'g',
    },
  });
  await source.commit(handle, {
    transactionId: 'trash-seed',
    trash: [{ path: 'deleted' }],
  });
  await source.writeGlobalConfig(
    {
      locale: 'zh',
      editor: { existing: false, imported: 'yes' },
      workspaceDevices: {
        [config.value.identity as string]: { sidebar: false },
      },
      desktopWorkspace: { path: '/must-not-import' },
    },
    0,
  );
  await target.writeGlobalConfig(
    { locale: 'en', editor: { existing: true } },
    0,
  );
  return { root, dataRoot, factory, source, handle, target };
}

describe('complete browser migration', () => {
  it('preserves files, binary resources, skills, configuration, session, trash and Git commit IDs without changing the source', async () => {
    const ctx = await setup();
    const folderId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const native = {
      format: 'verd-document',
      version: 1,
      id: documentId,
      title: 'Original document',
      text: {
        schemaVersion: 1,
        id: documentId,
        kind: 'block',
        plainText: 'Original document',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Original document' }],
            },
          ],
        },
      },
    };
    await ctx.source.commit(ctx.handle, {
      transactionId: 'stable-identities',
      writes: [
        folderIdentityWrite('empty', folderId),
        {
          path: 'original.verd-doc.json',
          content: JSON.stringify(native),
          expectedVersion: null,
        },
      ],
    });
    const projectIdentity = (await ctx.source.readSnapshot(ctx.handle)).config
      .value.identity;
    await ctx.source.git!(ctx.handle, {
      type: 'init',
      author: { name: 'Migration', email: 'migration@example.invalid' },
    });
    const status = (await ctx.source.git!(ctx.handle, { type: 'status' }))
      .status;
    const version = await ctx.source.git!(ctx.handle, {
      type: 'commit',
      message: 'Original history',
      expectedToken: status.token,
    });
    const beforeFile = await ctx.source.readFile(ctx.handle, 'notes.txt');
    await ctx.source.commit(ctx.handle, {
      transactionId: 'dirty-content',
      writes: [
        {
          path: 'notes.txt',
          content: 'Unsaved in Git',
          expectedVersion: beforeFile.version,
        },
      ],
    });
    await ctx.source.openWorkspace({ path: 'second', name: '第二个工作区' });
    const backup = await exportBrowserBackup(ctx.factory);
    const snapshot = JSON.stringify(encodeServiceValue(backup.databases));
    const imported = await ctx.target.serviceCall('importBrowserBackup', [
      backup,
      ctx.root,
    ]);
    expect(imported.count).toBe(2);
    const entries = (await fs.readdir(imported.path)).filter(
      (name) => !name.startsWith('.'),
    );
    const root = path.join(
      imported.path,
      entries.find((name) => name.startsWith('1-'))!,
    );
    expect(await fs.readFile(path.join(root, 'notes.txt'), 'utf8')).toBe(
      'Unsaved in Git',
    );
    expect(await fs.readFile(path.join(root, 'normal.lock'), 'utf8')).toBe(
      'ordinary file',
    );
    expect(
      new Uint8Array(
        await fs.readFile(
          path.join(root, '.verdscrolls/resources/assets/binary.dat'),
        ),
      ),
    ).toEqual(new Uint8Array([0, 255, 10, 128]));
    expect(
      await fs.readFile(
        path.join(root, '.agents/skills/custom/SKILL.md'),
        'utf8',
      ),
    ).toContain('Content');
    expect((await fs.stat(path.join(root, 'empty'))).isDirectory()).toBe(true);
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, '.verdscrolls/config.json'), 'utf8'),
      ).value.custom,
    ).toEqual({ kept: true });
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, '.verdscrolls/session.json'), 'utf8'),
      ).groups[0].name,
    ).toBe('Group');
    const handle = (await ctx.target.openWorkspace({
      path: root,
      create: false,
    }))!;
    const restored = await ctx.target.readSnapshot(handle);
    expect(restored.config.value.identity).toBe(projectIdentity);
    expect(
      restored.entries.find((entry) => entry.path === 'empty')?.folderId,
    ).toBe(folderId);
    expect(
      JSON.parse(
        await fs.readFile(path.join(root, 'original.verd-doc.json'), 'utf8'),
      ),
    ).toEqual(native);
    for (const node of backup.files.filter(
      (file) =>
        file.workspace === ctx.handle.key &&
        !file.path.startsWith('.git/') &&
        !file.path.startsWith('.verdscrolls/'),
    )) {
      expect(
        new Uint8Array(await fs.readFile(path.join(root, node.path))),
      ).toEqual((await ctx.source.readFile(ctx.handle, node.path)).content);
    }
    expect(restored.trash).toHaveLength(1);
    expect(
      (
        await ctx.target.commit(handle, {
          transactionId: 'restore-migrated-trash',
          restore: [{ entryId: restored.trash[0].entryId }],
        })
      ).outcome,
    ).toBe('applied');
    expect(await fs.readFile(path.join(root, 'deleted/old.txt'), 'utf8')).toBe(
      'Recover me',
    );
    expect(
      (await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim(),
    ).toBe(version.oid);
    await exec('git', ['-C', root, 'fsck', '--full']);
    expect((await exec('git', ['-C', root, 'show', ':notes.txt'])).stdout).toBe(
      'Original',
    );
    expect(
      (await ctx.target.git!(handle, { type: 'status' })).status
        .remoteSupported,
    ).toBe(true);
    expect(
      (await ctx.target.readGlobalConfig()).value.desktopWorkspace,
    ).toBeUndefined();
    expect((await ctx.target.readGlobalConfig()).value).toMatchObject({
      locale: 'en',
      editor: { existing: true, imported: 'yes' },
    });
    const again = await exportBrowserBackup(ctx.factory);
    expect(JSON.stringify(encodeServiceValue(again.databases))).toBe(snapshot);
    expect(
      await ctx.target.serviceCall('importBrowserBackup', [backup, ctx.root]),
    ).toEqual(imported);
  });
  it('preserves the backup and permits retry after a rejected checksum, without publishing a partial workspace', async () => {
    const ctx = await setup();
    const backup = await exportBrowserBackup(ctx.factory);
    const corrupted = structuredClone(backup);
    corrupted.files[0].digest = 'sha256-' + '0'.repeat(64);
    await expect(
      ctx.target.serviceCall('importBrowserBackup', [corrupted, ctx.root]),
    ).rejects.toThrow('checksum mismatch');
    expect(
      (await fs.readdir(ctx.root)).some((name) =>
        name.startsWith('browser-import-'),
      ),
    ).toBe(false);
    expect(
      (await fs.readdir(path.join(ctx.dataRoot, 'migrations'))).some((name) =>
        name.endsWith('.backup.json'),
      ),
    ).toBe(true);
    expect(
      (await ctx.target.serviceCall('importBrowserBackup', [backup, ctx.root]))
        .count,
    ).toBe(1);
  });
  it('resumes registration after publication was interrupted and never imports legacy receipts as new transactions', async () => {
    const ctx = await setup();
    const backup = await exportBrowserBackup(ctx.factory);
    const imported = await ctx.target.serviceCall('importBrowserBackup', [
      backup,
      ctx.root,
    ]);
    const ledger = (
      await fs.readdir(path.join(ctx.dataRoot, 'migrations'))
    ).find((name) => name.endsWith('.json') && !name.endsWith('.backup.json'))!;
    await fs.writeFile(
      path.join(ctx.dataRoot, 'migrations', ledger),
      JSON.stringify({ path: imported.path, count: 1, phase: 'prepared' }),
    );
    expect(
      await ctx.target.serviceCall('importBrowserBackup', [backup, ctx.root]),
    ).toEqual(imported);
    const roots = (await fs.readdir(imported.path)).filter(
      (name) => !name.startsWith('.'),
    );
    const receiptPath = path.join(
      imported.path,
      roots[0],
      '.verdscrolls/receipts/browser-seed.json',
    );
    await expect(fs.access(receiptPath)).rejects.toThrow();
  });
});
