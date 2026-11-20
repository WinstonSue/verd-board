import { randomUUID } from 'node:crypto';
import { watch, type Dirent, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { digest, withWorkspaceLock } from './file-lock.js';

const runtimeDirectory = '.verdscrolls';
const recoveryDirectory = runtimeDirectory + '/file-recovery';

export interface FileWorkspaceRead {
  bytes: Buffer;
  version: string;
}

export interface FileWorkspaceWriteOptions {
  /** Called synchronously with absolute content paths immediately before publication. */
  beforePublish?: (paths: readonly string[], recoveryPath?: string) => void;
  /** Retain the old bytes of a successful replacement, as well as its journal. */
  retainReplaced?: boolean;
}

export interface FileWorkspaceTransaction {
  mkdir(relative: string): Promise<void>;
  write(relative: string, bytes: string | Uint8Array, expectedVersion: string | null): Promise<void>;
  move(from: string, to: string, expectedVersion: string): Promise<void>;
  remove(relative: string, expectedVersion: string): Promise<void>;
  removeEmptyDirectory(relative: string): Promise<void>;
}

export interface FileWorkspace {
  readonly root: string;
  list(relative?: string): Promise<Dirent[]>;
  stat(relative: string): Promise<Stats>;
  read(relative: string): Promise<FileWorkspaceRead>;
  /** Includes the names and contents of directory descendants. */
  version(relative: string): Promise<string>;
  subscribe(onChange: (relative?: string) => void): () => void;
  transact<T>(
    edit: (transaction: FileWorkspaceTransaction) => Promise<T>,
    options?: FileWorkspaceWriteOptions,
  ): Promise<T>;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';

const listDirectory = (absolute: string) => fs.readdir(absolute, { withFileTypes: true });

function unsafePath(relative: string): boolean {
  return (
    path.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    /^[a-z]:/i.test(relative) ||
    relative.split('/').some((part) =>
      ['', '.', '..', '.git', runtimeDirectory, '.verdboard', '.verd-resources'].includes(part.toLowerCase()),
    )
  );
}

export class FileWorkspaceConflict extends Error {
  constructor(public readonly relative: string) {
    super('File workspace version changed: ' + relative);
    this.name = 'FileWorkspaceConflict';
  }
}

/** Opens ordinary files in place. Opening never initializes, repairs or writes the directory. */
export async function openFileWorkspace(folder: string): Promise<FileWorkspace> {
  const root = await fs.realpath(folder);
  const rootEntry = await fs.lstat(root);
  if (!rootEntry.isDirectory()) throw new Error('File workspace must be a directory');

  async function assertRoot() {
    const current = await fs.lstat(root);
    if (!current.isDirectory() || current.dev !== rootEntry.dev || current.ino !== rootEntry.ino)
      throw new Error('File workspace was replaced: ' + root);
  }

  async function checked(relative: string, internal = false) {
    if (relative && !internal && unsafePath(relative))
      throw new Error('Invalid file workspace path: ' + relative);
    await assertRoot();
    let absolute = root;
    for (const part of relative ? relative.split('/') : []) {
      absolute = path.join(absolute, part);
      const entry = await fs.lstat(absolute).catch((error) => {
        if (!missing(error)) throw error;
        return null;
      });
      if (entry && !entry.isDirectory() && !entry.isFile())
        throw new Error('File workspace refuses links and special files: ' + relative);
    }
    return absolute;
  }

  async function read(relative: string) {
    const bytes = await fs.readFile(await checked(relative));
    return { bytes, version: digest(bytes) };
  }

  async function entryVersion(absolute: string): Promise<string> {
    const entry = await fs.lstat(absolute);
    if (entry.isFile()) return digest(await fs.readFile(absolute));
    if (!entry.isDirectory()) throw new Error('File workspace refuses links and special files: ' + absolute);
    const children = (await listDirectory(absolute)).map((child) => child.name).sort();
    const manifest: [string, string][] = [];
    for (const name of children)
      manifest.push([name, await entryVersion(path.join(absolute, name))]);
    return 'tree-' + digest(JSON.stringify(manifest));
  }

  async function currentVersion(absolute: string) {
    return entryVersion(absolute).catch((error) => {
      if (!missing(error)) throw error;
      return null;
    });
  }

  async function journal(transactionId: string, operation: object) {
    const relative = recoveryDirectory + '/' + randomUUID();
    const absolute = await checked(relative, true);
    await fs.mkdir(absolute, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(absolute, 'operation.json'),
      JSON.stringify({ formatVersion: 1, transactionId, ...operation }),
      { mode: 0o600 },
    );
    return absolute;
  }

  return {
    root,
    list: async (relative = '') => listDirectory(await checked(relative)),
    stat: async (relative) => fs.lstat(await checked(relative)),
    read,
    version: async (relative) => entryVersion(await checked(relative)),
    subscribe(onChange) {
      const watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        const relative = filename?.split(path.sep).join('/');
        if (relative !== runtimeDirectory && !relative?.startsWith(runtimeDirectory + '/'))
          onChange(relative ?? undefined);
      });
      watcher.on('error', () => {
        watcher.close();
        onChange();
      });
      return () => watcher.close();
    },
    transact(edit, options = {}) {
      return withWorkspaceLock(root, async () => {
        await assertRoot();
        let active = true;
        const transactionId = randomUUID();
        const completed: string[] = [];
        const destination = (relative: string) => {
          if (!active) throw new Error('File workspace transaction is closed');
          if (!relative) throw new Error('File workspace root cannot be modified');
          return checked(relative);
        };
        const unchanged = async (relative: string, absolute: string, expected: string | null) => {
          if ((await destination(relative)) !== absolute || (await currentVersion(absolute)) !== expected)
            throw new FileWorkspaceConflict(relative);
        };
        async function publish(
          paths: readonly string[],
          verify: () => Promise<void>,
          apply: () => Promise<void>,
          recoveryPath?: string,
        ) {
          for (let attempt = 0; ; attempt++) {
            await verify();
            options.beforePublish?.(paths, recoveryPath);
            try {
              await apply();
              return;
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              if (attempt >= 2 || !code || !['EBUSY', 'EPERM', 'EACCES'].includes(code))
                throw error;
            }
          }
        }
        try {
          const value = await edit({
            async mkdir(relative) {
              const target = await destination(relative);
              const existing = await fs.lstat(target).catch((error) => {
                if (!missing(error)) throw error;
                return null;
              });
              if (existing?.isDirectory()) return;
              options.beforePublish?.([target]);
              await fs.mkdir(target, { recursive: true });
            },
            async write(relative, bytes, expectedVersion) {
              const target = await destination(relative);
              await unchanged(relative, target, expectedVersion);
              const version = digest(bytes);
              if (version === expectedVersion) return;
              const receipt = await journal(transactionId, {
                action: 'write',
                relative,
                expectedVersion,
                version,
              });
              const staged = path.join(receipt, 'incoming');
              await fs.writeFile(staged, bytes, { mode: 0o600 });
              if (expectedVersion !== null) {
                await fs.copyFile(target, path.join(receipt, 'previous'));
                // Preserve the existing file's mode on replacement.
                await fs.chmod(staged, (await fs.lstat(target)).mode & 0o777);
              } else {
                await fs.chmod(staged, 0o666 & ~process.umask());
              }
              const previous = expectedVersion === null ? undefined : path.join(receipt, 'previous');
              await publish(
                [target],
                () => unchanged(relative, target, expectedVersion),
                () =>
                  previous
                    ? fs.rename(staged, target)
                    : fs.link(staged, target).catch((error) => {
                        if (error.code === 'EEXIST') throw new FileWorkspaceConflict(relative);
                        throw error;
                      }),
                options.retainReplaced ? previous : undefined,
              );
              if (!previous || !options.retainReplaced) completed.push(receipt);
            },
            async move(from, to, expectedVersion) {
              const source = await destination(from);
              const target = await destination(to);
              if (source === target) return;
              await unchanged(from, source, expectedVersion);
              const existing = await fs.lstat(target).catch((error) => {
                if (!missing(error)) throw error;
                return null;
              });
              if (existing) {
                const original = await fs.lstat(source);
                if (
                  from.toLowerCase() !== to.toLowerCase() ||
                  original.dev !== existing.dev ||
                  original.ino !== existing.ino
                )
                  throw new FileWorkspaceConflict(to);
              }
              const receipt = await journal(transactionId, { action: 'move', from, to, expectedVersion });
              await publish(
                [source, target],
                async () => {
                  await unchanged(from, source, expectedVersion);
                  await unchanged(to, target, existing ? expectedVersion : null);
                },
                () => fs.rename(source, target),
              );
              completed.push(receipt);
            },
            async remove(relative, expectedVersion) {
              const target = await destination(relative);
              await unchanged(relative, target, expectedVersion);
              const receipt = await journal(transactionId, { action: 'remove', relative, expectedVersion });
              const previous = path.join(receipt, 'previous');
              await publish(
                [target],
                () => unchanged(relative, target, expectedVersion),
                () => fs.rename(target, previous),
                previous,
              );
            },
            async removeEmptyDirectory(relative) {
              const target = await destination(relative);
              options.beforePublish?.([target]);
              await fs.rmdir(target);
            },
          });
          for (const receipt of completed)
            await fs.rm(receipt, { recursive: true, force: true }).catch(() => {});
          return value;
        } finally {
          active = false;
        }
      });
    },
  };
}
