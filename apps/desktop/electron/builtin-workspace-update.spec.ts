import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  createFsWorkspaceHost,
  stageBuiltinWorkspace,
  readNativeSnapshot,
} from '@sue/verd-board-agent/node';
import { createBuiltinWorkspaceUpdater } from './builtin-workspace-update';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const f of cleanups.splice(0).reverse()) await f();
});
async function setup(kind: 'project' | 'agent-patterns' = 'project') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'verd-update-'));
  cleanups.push(() => fs.rm(userData, { recursive: true, force: true }));
  const source = (k: typeof kind) =>
    path.join(
      repo,
      k === 'project'
        ? 'workspace'
        : 'packages/product/agent-patterns/workspace',
    );
  const target = path.join(
    userData,
    'workspaces',
    kind === 'project' ? 'default' : 'agent-patterns',
  );
  await fs.mkdir(target, { recursive: true });
  await stageBuiltinWorkspace(source(kind), target, kind);
  const host = createFsWorkspaceHost({ defaultRoot: () => target });
  cleanups.push(async () => {
    for (const w of host.workspaces.values())
      await host.closeWorkspace({ key: w.id, name: w.name });
  });
  const handle = (await host.openWorkspace())!;
  const updater = createBuiltinWorkspaceUpdater({
    host,
    userData: () => userData,
    source,
  });
  return { userData, source, target, host, handle, updater };
}
it.each(['project', 'agent-patterns'] as const)(
  'fully replaces %s, backs up additions, retains identity and receipts, and fences old hosts',
  async (kind) => {
    const { target, host, handle, updater } = await setup(kind);
    const other = createFsWorkspaceHost({ defaultRoot: () => target });
    const oldHandle = (await other.openWorkspace())!;
    cleanups.push(() => other.closeWorkspace(oldHandle));
    const before = await host.readSnapshot(handle),
      snapshot = await readNativeSnapshot(target);
    await fs.writeFile(path.join(target, 'user-file.txt'), 'keep in backup');
    const receipt = await host.commit(handle, {
      transactionId: 'confirmed',
      writes: [
        { path: 'user-data.txt', content: 'saved', expectedVersion: null },
      ],
    });
    const info = (await updater.info(handle))!;
    const next = await updater.update(handle, info.releaseId);
    expect(next.key).not.toBe(handle.key);
    expect((await host.readSnapshot(next)).config.value.identity).toBe(
      before.config.value.identity,
    );
    expect((await host.readSnapshot(next)).config.version).toBe(
      before.config.version + 1,
    );
    await expect(
      fs.access(path.join(target, 'user-file.txt')),
    ).rejects.toThrow();
    const backups = await updater.backups(next),
      directories = await fs.readdir(backups);
    expect(
      await fs.readFile(
        path.join(backups, directories[0], 'user-file.txt'),
        'utf8',
      ),
    ).toBe('keep in backup');
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(target, '.verdscrolls/receipts/confirmed.json'),
          'utf8',
        ),
      ),
    ).toEqual(receipt);
    expect((await readNativeSnapshot(target)).version).not.toBe(
      snapshot.version,
    );
    await expect(
      other.commit(oldHandle, {
        transactionId: 'stale',
        writes: [{ path: 'stale.txt', content: 'bad', expectedVersion: null }],
      }),
    ).rejects.toThrow('WORKSPACE_REPLACED');
    await expect(other.readSnapshot(oldHandle)).rejects.toThrow(
      'WORKSPACE_REPLACED',
    );
    await updater.update(next, info.releaseId);
    expect(
      JSON.parse(
        await fs.readFile(
          path.join(target, '.verdscrolls/receipts/confirmed.json'),
          'utf8',
        ),
      ),
    ).toEqual(receipt);
  },
);
it('rejects an unconfirmed resource revision without changing the existing workspace', async () => {
  const { target, handle, updater } = await setup();
  const before = await fs.readFile(
    path.join(target, '.verdscrolls/config.json'),
    'utf8',
  );
  await expect(updater.update(handle, 'wrong')).rejects.toThrow(
    'resources changed',
  );
  expect(
    await fs.readFile(path.join(target, '.verdscrolls/config.json'), 'utf8'),
  ).toBe(before);
});
it('recovers a crash between the backup and publication before opening', async () => {
  const { target, userData, handle, host, updater } = await setup();
  await host.closeWorkspace(handle);
  const id = randomUUID(),
    backup = path.join(userData, 'workspace-backups/project', id);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.mkdir(path.join(userData, 'workspace-updates'), { recursive: true });
  await fs.writeFile(
    path.join(userData, 'workspace-updates/project.json'),
    JSON.stringify({ id, generation: randomUUID() }),
  );
  await fs.rename(target, backup);
  await updater.recover();
  expect((await host.openWorkspace())?.name).toBe('青编项目工作区');
  await expect(fs.access(backup)).rejects.toThrow();
});

it('rejects a pending authoring plan even when resetting to identical native content', async () => {
  const { prepareAuthoringBatch } =
    await import('../../../packages/product/agent/src/authoring');
  const { applyPreparedBatch } =
    await import('../../../packages/product/agent/src/apply');
  const { target, handle, updater } = await setup();
  const plan = await prepareAuthoringBatch(await readNativeSnapshot(target), [
    {
      type: 'file.create',
      kind: 'document',
      id: 'pending-document',
      title: 'Pending',
      path: 'pending.verd-doc.json',
    },
  ]);
  const info = (await updater.info(handle))!;
  await updater.update(handle, info.releaseId);
  await expect(applyPreparedBatch(target, plan)).rejects.toThrow(
    'VERSION_CONFLICT',
  );
});

it('finishes recovery of an already published new directory without removing the backup', async () => {
  const { target, userData, source, handle, host, updater } = await setup();
  await host.closeWorkspace(handle);
  const id = randomUUID(),
    backup = path.join(userData, 'workspace-backups/project', id),
    staging = target + '.update-' + id;
  await fs.mkdir(staging);
  await stageBuiltinWorkspace(source('project'), staging, 'project');
  const instance = JSON.parse(
    await fs.readFile(path.join(staging, '.verdscrolls/instance.json'), 'utf8'),
  );
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.mkdir(path.join(userData, 'workspace-updates'), { recursive: true });
  await fs.writeFile(
    path.join(userData, 'workspace-updates/project.json'),
    JSON.stringify({ id, generation: instance.generation }),
  );
  await fs.rename(target, backup);
  await fs.rename(staging, target);
  await updater.recover();
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(target, '.verdscrolls/instance.json'),
        'utf8',
      ),
    ).generation,
  ).toBe(instance.generation);
  await expect(fs.access(backup)).resolves.toBeUndefined();
});

it('leaves the old workspace usable when a transaction is unconfirmed', async () => {
  const { target, host, handle, updater } = await setup();
  await fs.mkdir(path.join(target, '.verdscrolls/receipts'), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(target, '.verdscrolls/receipts/unknown.json'),
    JSON.stringify({ outcome: 'rejected', reason: 'io-error' }),
  );
  const info = (await updater.info(handle))!;
  await expect(updater.update(handle, info.releaseId)).rejects.toThrow(
    'Unconfirmed',
  );
  await expect(host.readSnapshot(handle)).resolves.toBeDefined();
});

it('replaces the legacy directory layout while preserving original paths in the backup', async () => {
  const { target, host, handle, updater } = await setup();
  await fs.rename(
    path.join(target, '文档导航.verd-doc.json'),
    path.join(target, '文档/文档导航.verd-doc.json'),
  );
  await fs.rename(
    path.join(target, '架构图/项目导览.verd.json'),
    path.join(target, '项目导览.verd.json'),
  );
  const identity = (await host.readSnapshot(handle)).config.value.identity;
  const info = (await updater.info(handle))!;
  const next = await updater.update(handle, info.releaseId);
  for (const file of ['文档/文档导航.verd-doc.json', '项目导览.verd.json'])
    await expect(fs.access(path.join(target, file))).rejects.toThrow();
  for (const file of [
    '文档导航.verd-doc.json',
    'Documentation.verd-doc.json',
    '架构图/项目导览.verd.json',
  ])
    await expect(fs.access(path.join(target, file))).resolves.toBeUndefined();
  expect((await host.readSnapshot(next)).config.value.identity).toBe(identity);
  const backups = await updater.backups(next),
    copies = await fs.readdir(backups);
  await expect(
    fs.access(path.join(backups, copies[0], '文档/文档导航.verd-doc.json')),
  ).resolves.toBeUndefined();
});
