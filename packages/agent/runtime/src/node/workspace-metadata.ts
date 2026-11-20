import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  WORKSPACE_META_DIR,
  LEGACY_WORKSPACE_META_DIR,
} from '@sue/verd-board-workspace';
import { configuredProjectWorkspace } from './workspace-context';

export const metadataPath = (root: string, ...parts: string[]) =>
  path.join(root, WORKSPACE_META_DIR, ...parts);
export async function metadataState(root: string, name: string) {
  const dir = path.join(root, name);
  const stat = await fs.lstat(dir).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
    throw new Error(
      `WORKSPACE_METADATA_CONFLICT: ${name} must be a real directory`,
    );
  return stat ? { empty: (await fs.readdir(dir)).length === 0 } : null;
}

/** Must run inside the unchanged cross-process workspace lock, before initialization. */
export async function migrateWorkspaceMetadataUnlocked(root: string) {
  const old = await metadataState(root, LEGACY_WORKSPACE_META_DIR);
  const current = await metadataState(root, WORKSPACE_META_DIR);
  if (!old) return false;
  if (
    current &&
    (await fs.lstat(metadataPath(root, 'migration', 'metadata-v2.json')).then(
      () => true,
      () => false,
    ))
  )
    throw new Error(
      'WORKSPACE_LEGACY_WRITER: .verdboard reappeared after initialization; close the older application before writing',
    );
  if (current && !current.empty && !old.empty)
    throw new Error(
      'WORKSPACE_METADATA_CONFLICT: both .verdboard and .verdscrolls contain data; close older applications and resolve the two directories before writing',
    );
  if (current && !current.empty) {
    await fs.rmdir(path.join(root, LEGACY_WORKSPACE_META_DIR));
    return false;
  }
  if (current) await fs.rmdir(metadataPath(root));
  await fs.rename(
    path.join(root, LEGACY_WORKSPACE_META_DIR),
    metadataPath(root),
  );
  return true;
}

/** Persistent format marker distinguishes initial empty-directory cleanup from an old writer. */
export async function markCurrentMetadataUnlocked(root: string) {
  await fs.mkdir(metadataPath(root, 'migration'), { recursive: true });
  await fs
    .writeFile(
      metadataPath(root, 'migration', 'metadata-v2.json'),
      '{"version":2}\n',
      { flag: 'wx' },
    )
    .catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
}

/** An old application may recreate its metadata after migration. Never merge it. */
export async function assertCurrentMetadataUnlocked(root: string) {
  await metadataState(root, WORKSPACE_META_DIR);
  if (await metadataState(root, LEGACY_WORKSPACE_META_DIR))
    throw new Error(
      'WORKSPACE_LEGACY_WRITER: .verdboard reappeared; close the older application before writing',
    );
}

/** Nearest initialized ancestor wins. An uninitialized Git root is a boundary. */
export async function discoverWorkspace(
  start: string,
  explicit?: string,
): Promise<string> {
  if (explicit) return fs.realpath(path.resolve(explicit));
  let dir = await fs.realpath(path.resolve(start));
  if (!(await fs.stat(dir)).isDirectory()) dir = path.dirname(dir);
  for (;;) {
    const configured = await configuredProjectWorkspace(dir);
    if (configured) return configured;
    if (
      (await metadataState(dir, WORKSPACE_META_DIR)) ||
      (await metadataState(dir, LEGACY_WORKSPACE_META_DIR))
    )
      return dir;
    if (
      await fs.lstat(path.join(dir, '.git')).then(
        () => true,
        () => false,
      )
    )
      break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'WORKSPACE_NOT_FOUND: run verd init --workspace PATH or open the folder in Desktop',
  );
}
