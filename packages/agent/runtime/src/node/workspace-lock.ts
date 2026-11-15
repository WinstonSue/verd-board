import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readWorkspaceSkillsUnlocked } from './workspace-skills';
import {
  FOLDER_ID_FILE,
  isProjectInternalPath,
  readFolderIdentity,
  type NativeWorkspaceEntry,
  type AuthoringDiagnostic,
} from '@sue/verd-board-workspace';

export const digest = (content: string | Uint8Array) =>
  `sha256-${createHash('sha256').update(content).digest('hex')}`;
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
async function canonicalRoot(root: string): Promise<string> {
  try {
    return await fs.realpath(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(path.resolve(root));
    return path.join(await canonicalRoot(parent), path.basename(root));
  }
}
/** Shared by Desktop and every CLI process; lives outside the content workspace. */
export async function withWorkspaceLock<T>(
  root: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = digest(await canonicalRoot(root));
  const base = path.join(os.tmpdir(), 'verdboard-workspace-locks');
  await fs.mkdir(base, { recursive: true });
  const lock = path.join(base, key),
    recovery = lock + '.reclaim',
    nonce = randomUUID(),
    started = Date.now();
  const owner = { pid: process.pid, nonce },
    ownership = `${lock}.owner-${process.pid}-${nonce}`;
  const bytes = JSON.stringify(owner);
  // A hard link publishes a fully written ownership record atomically.
  await fs.writeFile(ownership, bytes, { flag: 'wx' });
  let acquired = false;
  try {
    for (;;) {
      const reclaiming = await fs
        .readFile(path.join(recovery, 'owner.json'), 'utf8')
        .catch(() => null);
      if (
        !reclaiming &&
        !(await fs.stat(recovery).then(
          () => true,
          () => false,
        ))
      ) {
        try {
          await fs.link(ownership, lock);
          acquired = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const previousBytes = await fs.readFile(lock, 'utf8').catch(() => '');
        let previous: typeof owner | undefined;
        try {
          previous = JSON.parse(previousBytes);
        } catch {
          /* never steal malformed ownership */
        }
        if (previous && Number.isInteger(previous.pid) && previous.pid > 0) {
          let dead = false;
          try {
            process.kill(previous.pid, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === 'ESRCH';
          }
          if (dead) {
            const claimed = await fs.mkdir(recovery).then(
              () => true,
              (error) => {
                if (error.code === 'EEXIST') return false;
                throw error;
              },
            );
            if (claimed)
              try {
                await fs.writeFile(path.join(recovery, 'owner.json'), bytes);
                if (
                  (await fs.readFile(lock, 'utf8').catch(() => '')) ===
                  previousBytes
                )
                  await fs.unlink(lock).catch(() => {});
              } finally {
                await fs.rm(recovery, { recursive: true, force: true });
              }
          }
        }
      } else if (reclaiming) {
        try {
          process.kill(JSON.parse(reclaiming).pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH')
            throw new Error(
              'WORKSPACE_RECOVERY_REQUIRED: interrupted lock recovery at ' +
                recovery,
            );
        }
      }
      if (Date.now() - started > 15000)
        throw new Error(
          'WORKSPACE_BUSY: another writer holds the workspace lock',
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return await task();
  } finally {
    if (acquired && (await fs.readFile(lock, 'utf8').catch(() => '')) === bytes)
      await fs.unlink(lock);
    await fs.unlink(ownership).catch(() => {});
  }
}

export async function readWorkspaceGeneration(
  root: string,
): Promise<string | null> {
  try {
    const file = path.join(root, '.verdscrolls/instance.json');
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error('Invalid workspace instance');
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof value.generation !== 'string' || !value.generation)
      throw new Error('Invalid workspace instance');
    return value.generation;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export interface NativeSnapshot {
  root: string;
  version: string;
  entries: (NativeWorkspaceEntry & { source: string; version: string })[];
  diagnostics: AuthoringDiagnostic[];
  resourceId?: string | null;
  folderIds?: string[];
}
/** Caller must hold the common workspace lock. Does not create metadata or recover. */
export async function readNativeSnapshotUnlocked(
  root: string,
): Promise<NativeSnapshot> {
  root = await canonicalRoot(root);
  const entries: NativeSnapshot['entries'] = [],
    diagnostics: AuthoringDiagnostic[] = [];
  const manifest: [string, string][] = [];
  const folderIds: string[] = [];
  async function walk(dir: string) {
    const children = await fs
      .readdir(path.join(root, dir), { withFileTypes: true })
      .catch((error) => {
        if (error.code === 'ENOENT' && !dir) return [];
        throw error;
      });
    const marker = children.find((child) => child.name === FOLDER_ID_FILE);
    if (dir && marker?.isFile()) {
      const relative = `${dir}/${FOLDER_ID_FILE}`;
      const bytes = await fs.readFile(path.join(root, relative), 'utf8');
      const folderId = readFolderIdentity(bytes);
      if (folderId) folderIds.push(folderId);
      manifest.push([relative, digest(bytes)]);
    }
    for (const child of children.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (
        isProjectInternalPath(child.name) ||
        ['.git', '.agents', 'node_modules'].includes(child.name)
      )
        continue;
      const relative = dir ? `${dir}/${child.name}` : child.name;
      if (child.isDirectory()) await walk(relative);
      else if (/\.verd(?:-doc)?\.json$/.test(child.name)) {
        if (child.isSymbolicLink())
          throw new Error('Native content cannot be a symlink: ' + relative);
        const source = await fs.readFile(path.join(root, relative), 'utf8'),
          version = digest(source);
        manifest.push([relative, version]);
        try {
          entries.push({
            path: relative,
            source,
            version,
            file: JSON.parse(source),
          });
        } catch {
          diagnostics.push({
            code: 'file.invalid',
            severity: 'error',
            path: relative,
            message: 'Invalid JSON',
          });
        }
      }
    }
  }
  await walk('');
  const skills = await readWorkspaceSkillsUnlocked(root);
  manifest.push(...skills.manifest);
  diagnostics.push(...skills.diagnostics);
  const journals = await fs
    .readdir(path.join(root, '.verdscrolls', 'transactions'))
    .catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  if (journals.some((p) => p.endsWith('.json')))
    diagnostics.push({
      code: 'workspace.recovery-required',
      severity: 'error',
      message:
        'A pending transaction needs recovery before authoring; read-only inspection did not change it.',
    });
  const generation = await readWorkspaceGeneration(root);
  return {
    root,
    version: digest(
      JSON.stringify(generation ? [generation, manifest] : manifest),
    ),
    entries,
    diagnostics,
    folderIds,
    resourceId: await readWorkspaceResourceId(root),
  };
}
/** Metadata identity is independent of the native-file digest. No initialization or recovery. */
export async function readWorkspaceResourceId(
  root: string,
): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(root, '.verdscrolls/shared/manifest.json'),
        'utf8',
      ),
    );
    if (
      manifest.format !== 'verd-agent-resources' ||
      typeof manifest.id !== 'string'
    )
      throw new Error('Invalid shared resources manifest');
    return manifest.id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
export const readNativeSnapshot = (root: string) =>
  withWorkspaceLock(root, () => readNativeSnapshotUnlocked(root));
