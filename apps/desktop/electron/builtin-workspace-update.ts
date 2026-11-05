import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createFsWorkspaceHost,
  readBuiltinRelease,
  stageBuiltinWorkspace,
  withWorkspaceLock,
  type BuiltinWorkspaceKind,
} from '@sue/verd-board-agent/node';
import type { WorkspaceHandle } from '../../../packages/product/app/src/host/workspace-host';

const exists = (p: string) =>
  fs.lstat(p).then(
    () => true,
    (e) => {
      if (e.code === 'ENOENT') return false;
      throw e;
    },
  );
const json = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const directoryEntries = (dir: string): Promise<string[]> =>
  fs.readdir(dir).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
export function createBuiltinWorkspaceUpdater(options: {
  host: ReturnType<typeof createFsWorkspaceHost>;
  userData: () => string;
  appVersion?(): string;
  registerBackup?(root: string): Promise<void>;
  source: (kind: BuiltinWorkspaceKind) => string;
}) {
  const rootFor = (kind: BuiltinWorkspaceKind) =>
    path.join(
      options.userData(),
      'workspaces',
      kind === 'project' ? 'default' : 'agent-patterns',
    );
  const backupDirectory = (kind: BuiltinWorkspaceKind) =>
    path.join(options.userData(), 'workspace-backups', kind);
  const logFor = (kind: BuiltinWorkspaceKind) =>
    path.join(options.userData(), 'workspace-updates', kind + '.json');
  const kindOf = async (handle: WorkspaceHandle) => {
    const workspace = options.host.workspaces.get(handle.key);
    if (!workspace) throw new Error('Workspace unavailable');
    for (const kind of ['project', 'agent-patterns'] as const) {
      const root = rootFor(kind);
      if (
        path.resolve(workspace.root) === path.resolve(root) &&
        !(await fs.lstat(root)).isSymbolicLink()
      )
        return kind;
    }
    return null;
  };
  const lastBackupFile = (kind: BuiltinWorkspaceKind) =>
    path.join(options.userData(), 'workspace-updates', kind + '-backup.json');
  async function rememberBackup(kind: BuiltinWorkspaceKind, backup?: string) {
    if (!backup) return;
    await options.registerBackup?.(backup);
    await fs.mkdir(path.dirname(lastBackupFile(kind)), { recursive: true });
    await fs.writeFile(lastBackupFile(kind), JSON.stringify({ path: backup }));
  }
  async function recoverKind(kind: BuiltinWorkspaceKind) {
    const log = logFor(kind);
    if (!(await exists(log))) return;
    await withWorkspaceLock(rootFor(kind), async () => {
      if (!(await exists(log))) return;
      const record = await json(log);
      if (!/^[a-f0-9-]+$/.test(record.id))
        throw new Error('Invalid workspace update journal');
      const target = rootFor(kind),
        staging = target + '.update-' + record.id;
      // v1 journals used a permanent backup as the rollback directory.
      const rollback =
        record.version === 2
          ? target + '.previous-' + record.id
          : path.join(backupDirectory(kind), record.id);
      if (await exists(target)) {
        const instance = await json(
          path.join(target, '.verdscrolls/instance.json'),
        ).catch(() => null);
        if (instance?.generation === record.generation) {
          await rememberBackup(kind, record.backup);
          if (record.version === 2)
            await fs.rm(rollback, { recursive: true, force: true });
          await fs.rm(staging, { recursive: true, force: true });
          await fs.rm(log);
          return;
        }
        if (await exists(rollback))
          throw new Error('Ambiguous workspace recovery; all copies preserved');
      } else if (await exists(rollback)) await fs.rename(rollback, target);
      else
        throw new Error(
          'Workspace update recovery requires attention; all copies preserved',
        );
      await rememberBackup(kind, record.backup);
      await fs.rm(staging, { recursive: true, force: true });
      await fs.rm(log);
    });
  }
  return {
    async recover() {
      for (const kind of ['project', 'agent-patterns'] as const)
        await recoverKind(kind);
    },
    async info(handle: WorkspaceHandle) {
      const kind = await kindOf(handle);
      if (!kind) return null;
      const release = await readBuiltinRelease(
        options.source(kind),
        kind,
        options.appVersion?.(),
      );
      const instance = await json(
        path.join(rootFor(kind), '.verdscrolls/instance.json'),
      ).catch(() => null);
      return {
        kind,
        version: options.appVersion?.() ?? release.appVersion ?? 'unknown',
        currentVersion:
          instance?.appVersion ?? instance?.packageVersion ?? null,
        currentReleaseId: instance?.releaseId ?? null,
        releaseId: release.releaseId,
        hasBackups:
          (await exists(lastBackupFile(kind))) ||
          (await fs.readdir(backupDirectory(kind)).catch(() => [])).length > 0,
      };
    },
    async backups(handle: WorkspaceHandle) {
      const kind = await kindOf(handle);
      if (!kind) throw new Error('Not a managed built-in workspace');
      const recent = await json(lastBackupFile(kind)).catch(() => null);
      const dir = recent?.path ?? backupDirectory(kind);
      if (!recent) await fs.mkdir(dir, { recursive: true });
      return dir;
    },
    async update(
      handle: WorkspaceHandle,
      releaseId: string,
      updateOptions: { backupParent?: string } = {},
    ) {
      const kind = await kindOf(handle);
      if (!kind) throw new Error('Not a managed built-in workspace');
      const source = options.source(kind);
      const target = rootFor(kind),
        id = randomUUID(),
        staging = target + '.update-' + id;
      const rollback = target + '.previous-' + id,
        log = logFor(kind);
      let backup: string | undefined;
      if (updateOptions.backupParent) {
        const parent = await fs.realpath(updateOptions.backupParent);
        for (const protectedRoot of [
          rootFor('project'),
          rootFor('agent-patterns'),
          options.source('project'),
          options.source('agent-patterns'),
        ]) {
          const canonical = await fs.realpath(protectedRoot).catch((error) => {
            if (error.code === 'ENOENT') return path.resolve(protectedRoot);
            throw error;
          });
          const relative = path.relative(canonical, parent);
          if (
            !relative ||
            (!relative.startsWith('..' + path.sep) &&
              relative !== '..' &&
              !path.isAbsolute(relative))
          )
            throw new Error(
              'Choose a backup folder outside the built-in workspace',
            );
        }
        backup = path.join(
          parent,
          (kind === 'project' ? '系统介绍' : 'Agent 范式库') +
            '-备份-' +
            new Date().toISOString().replace(/[:.]/g, '-') +
            '-' +
            id,
        );
      }
      await fs.mkdir(staging);
      let journaled = false;
      let generation: string | undefined;
      try {
        const release = await stageBuiltinWorkspace(
          source,
          staging,
          kind,
          options.appVersion?.(),
        );
        if (release.releaseId !== releaseId)
          throw new Error('Built-in resources changed; check again');
        await options.host.maintainWorkspace(handle, async (root) => {
          const old = await json(path.join(root, '.verdscrolls/config.json'));
          const config = await json(
            path.join(staging, '.verdscrolls/config.json'),
          );
          config.value.identity = old.value.identity;
          config.version = old.version + 1;
          await fs.writeFile(
            path.join(staging, '.verdscrolls/config.json'),
            JSON.stringify(config, null, 2) + '\n',
          );
          const receipts = path.join(root, '.verdscrolls/receipts');
          for (const name of await directoryEntries(receipts)) {
            const stat = await fs.lstat(path.join(receipts, name));
            if (!stat.isFile() || stat.isSymbolicLink())
              throw new Error('Invalid transaction receipt path');
            const value = await json(path.join(receipts, name));
            if (value.reason === 'io-error')
              throw new Error(
                'Unconfirmed transaction; retry saving before updating',
              );
            if (value.outcome !== 'applied' && value.outcome !== 'rejected')
              throw new Error('Invalid transaction receipt');
            await fs.mkdir(path.join(staging, '.verdscrolls/receipts'), {
              recursive: true,
            });
            await fs.copyFile(
              path.join(receipts, name),
              path.join(staging, '.verdscrolls/receipts', name),
            );
          }
          const pending = await directoryEntries(
            path.join(root, '.verdscrolls/transactions'),
          );
          if (pending.length)
            throw new Error('Pending transactions prevent updating');
          if (backup) {
            await fs.cp(root, backup, {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
            // Keep a full, editable copy. Its history name is independent of the original project name.
          }
          await fs.mkdir(path.dirname(log), { recursive: true });
          const instance = await json(
            path.join(staging, '.verdscrolls/instance.json'),
          );
          generation = instance.generation;
          const journal = await fs.open(log, 'wx');
          try {
            await journal.writeFile(
              JSON.stringify({ version: 2, id, generation, backup }),
            );
            await journal.sync();
          } finally {
            await journal.close();
          }
          journaled = true;
          await fs.rename(root, rollback);
          await fs.rename(staging, root);
          await rememberBackup(kind, backup);
          await fs.rm(rollback, { recursive: true, force: true });
          await fs.rm(log);
          journaled = false;
        });
      } catch (error) {
        if (journaled) {
          await recoverKind(kind);
          journaled = false;
          const installed = await json(
            path.join(target, '.verdscrolls/instance.json'),
          ).catch(() => null);
          if (installed?.generation !== generation) throw error;
        } else throw error;
      } finally {
        if (!journaled) await fs.rm(staging, { recursive: true, force: true });
      }
      const next = await options.host.openWorkspace({ path: target });
      if (!next)
        throw new Error(
          'Updated workspace could not be opened; reopen it to retry',
        );
      return { ...next, isDefault: kind === 'project' };
    },
  };
}
