import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  LEGACY_RESOURCE_DIR,
  RESOURCE_DIR,
  normalizeResourceKey,
  resourceStoragePath,
  type WorkspaceResourceMeta,
} from '@sue/verd-board-workspace';

/** Reject symlinks at every component, including a not-yet-created destination. */
export async function assertResourcePath(root: string, key: string) {
  const relative = resourceStoragePath(key);
  let target = root;
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    const stat = await fs.lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error('Resource path cannot be a symlink');
  }
  return target;
}

const state = async (target: string) =>
  fs.lstat(target).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });

async function hasContent(directory: string): Promise<boolean> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) return true;
    if (await hasContent(path.join(directory, entry.name))) return true;
  }
  return false;
}

/** Caller holds the workspace lock and has finished recovery of old journals. */
export async function migrateWorkspaceResourcesUnlocked(root: string) {
  const old = path.join(root, LEGACY_RESOURCE_DIR);
  const current = path.join(root, RESOURCE_DIR);
  const marker = path.join(root, '.verdscrolls/migration/resources-v1.json');
  const previous = await state(old);
  const destination = await state(current);
  for (const stat of [previous, destination])
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw new Error(
        'Resource migration conflict: resource directory must be an ordinary directory',
      );
  if (previous) {
    if (await state(marker))
      throw new Error(
        'Resource migration conflict: an older writer recreated .verd-resources',
      );
    const oldHasContent = await hasContent(old);
    const currentHasContent = destination ? await hasContent(current) : false;
    if (oldHasContent && currentHasContent)
      throw new Error(
        'Resource migration conflict: both resource directories exist; both were preserved',
      );
    if (destination && !oldHasContent) await fs.rm(old, { recursive: true });
    else {
      if (destination) await fs.rm(current, { recursive: true });
      await fs.rename(old, current);
    }
  }
  await fs.mkdir(path.dirname(marker), { recursive: true });
  await fs
    .writeFile(marker, '{"version":1}\n', { flag: 'wx' })
    .catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
}

export async function assertResourceLayout(root: string) {
  if (await state(path.join(root, LEGACY_RESOURCE_DIR)))
    throw new Error(
      'Resource migration conflict: close older writers and reopen the workspace',
    );
}

export async function readResourceMetadata(
  root: string,
  digest: (bytes: Uint8Array) => string,
) {
  const resources: WorkspaceResourceMeta[] = [];
  for (const group of ['assets', 'history']) {
    await assertResourcePath(root, `${group}/index.json`);
    const directory = path.join(root, RESOURCE_DIR, group);
    const names = await fs
      .readdir(directory, { withFileTypes: true })
      .catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    for (const entry of names) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const key = `${group}/${entry.name}`;
      try {
        normalizeResourceKey(key);
      } catch {
        continue;
      }
      const bytes = await fs.readFile(await assertResourcePath(root, key));
      resources.push({ key, version: digest(bytes), size: bytes.length });
    }
  }
  return resources.sort((a, b) => a.key.localeCompare(b.key));
}

/** Preserve durable source assets and local history during a content replacement. */
export async function preserveWorkspaceResources(
  root: string,
  staging: string,
) {
  await assertResourceLayout(root);
  for (const group of ['assets', 'history']) {
    await assertResourcePath(root, `${group}/index.json`);
    const source = path.join(root, RESOURCE_DIR, group);
    for (const entry of await fs
      .readdir(source, { withFileTypes: true })
      .catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })) {
      if (!entry.isFile() || entry.isSymbolicLink())
        throw new Error('Invalid durable resource: ' + entry.name);
      const key = normalizeResourceKey(`${group}/${entry.name}`);
      const target = await assertResourcePath(staging, key);
      const bytes = await fs.readFile(await assertResourcePath(root, key));
      if (await state(target)) {
        const existing = await fs.readFile(target);
        if (!existing.equals(bytes))
          throw new Error('Conflicting durable resource: ' + key);
      } else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: 'wx' });
      }
    }
  }
}
