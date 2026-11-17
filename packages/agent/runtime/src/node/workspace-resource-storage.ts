import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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

const conflict = (message: string) =>
  new Error('Resource migration conflict: ' + message);
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const migrationDirectory = '.verdscrolls/migration';
const archivePath = migrationDirectory + '/resources-v1-legacy';
const markerPath = migrationDirectory + '/resources-v1.json';

/** Validate parents even when the final directory has not been created yet. */
async function ordinaryDirectory(root: string, relative: string) {
  let target = root;
  for (const part of relative.split('/')) {
    target = path.join(target, part);
    const stat = await state(target);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
      throw conflict('expected an ordinary directory: ' + relative);
  }
  return target;
}

async function ordinaryFile(target: string) {
  const stat = await state(target);
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw conflict('expected an ordinary file: ' + target);
  return stat;
}

type Inventory = Map<string, string>;
async function inventory(root: string, relative: string, legacy: boolean) {
  const directory = await ordinaryDirectory(root, relative);
  const files: Inventory = new Map();
  if (!(await state(directory))) return files;
  const entries = await fs.readdir(directory);
  if (legacy && entries.some((name) => name !== 'assets' && name !== 'history'))
    throw conflict('unknown legacy resource entry; original was preserved');
  // Other current entries include Agent runtimes. Never traverse or change them.
  for (const group of ['assets', 'history']) {
    const folder = await ordinaryDirectory(root, relative + '/' + group);
    if (!(await state(folder))) continue;
    for (const name of (await fs.readdir(folder)).sort()) {
      const key = group + '/' + name;
      try {
        normalizeResourceKey(key);
      } catch {
        throw conflict('invalid resource name: ' + key);
      }
      const file = path.join(folder, name);
      await ordinaryFile(file);
      files.set(key, hash(await fs.readFile(file)));
    }
  }
  return files;
}

function assertCompatible(source: Inventory, destination: Inventory) {
  for (const [key, version] of source)
    if (destination.has(key) && destination.get(key) !== version)
      throw conflict('different bytes at ' + key + '; both were preserved');
}

function assertComplete(source: Inventory, destination: Inventory) {
  assertCompatible(source, destination);
  for (const key of source.keys())
    if (!destination.has(key))
      throw conflict('resource was not published: ' + key);
}

async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Publish complete bytes without ever replacing an existing name. */
async function publish(
  root: string,
  relative: string,
  bytes: Uint8Array,
  staging: string,
) {
  const folder = await ordinaryDirectory(root, path.posix.dirname(relative));
  const scratch = await ordinaryDirectory(root, staging);
  const target = path.join(root, relative);
  await ordinaryFile(target);
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(scratch, { recursive: true });
  // Stage in the resource directory, outside assets/history. A crash can leave
  // this private file, but it cannot expose a partial resource or hide a source.
  const temporary = path.join(scratch, `.resources-v1-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await ordinaryFile(target);
      if (hash(await fs.readFile(target)) !== hash(bytes))
        throw conflict('destination changed at ' + relative);
    }
    await syncDirectory(folder);
  } finally {
    await fs.unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

/** Caller holds the workspace lock and has finished recovery of old journals. */
export async function migrateWorkspaceResourcesUnlocked(root: string) {
  const old = path.join(root, LEGACY_RESOURCE_DIR);
  const marker = path.join(root, markerPath);
  const archive = await ordinaryDirectory(root, archivePath);
  await ordinaryDirectory(root, LEGACY_RESOURCE_DIR);
  await ordinaryDirectory(root, RESOURCE_DIR);
  await ordinaryFile(marker);
  const previous = await state(old);
  const archived = await state(archive);
  if (await state(marker)) {
    if (previous) throw conflict('an older writer recreated .verd-resources');
    return;
  }
  if (previous && archived)
    throw conflict(
      'legacy directory and archive both exist; both were preserved',
    );
  const sourcePath = previous ? LEGACY_RESOURCE_DIR : archivePath;
  // No publication (even of unrelated missing files) before the entire preflight.
  const source = await inventory(root, sourcePath, true);
  const destination = await inventory(root, RESOURCE_DIR, false);
  assertCompatible(source, destination);
  for (const [key, version] of source) {
    if (destination.has(key)) continue;
    await ordinaryFile(path.join(root, sourcePath, key));
    const bytes = await fs.readFile(path.join(root, sourcePath, key));
    if (hash(bytes) !== version) throw conflict('source changed at ' + key);
    await publish(root, RESOURCE_DIR + '/' + key, bytes, RESOURCE_DIR);
  }
  assertComplete(
    await inventory(root, sourcePath, true),
    await inventory(root, RESOURCE_DIR, false),
  );
  if (previous) {
    await ordinaryDirectory(root, migrationDirectory);
    await fs.mkdir(path.dirname(archive), { recursive: true });
    if (await state(archive))
      throw conflict('archive appeared during migration');
    await fs.rename(old, archive);
    await syncDirectory(root);
    await syncDirectory(path.dirname(archive));
  }
  // Re-scan after rename: an old writer may have added a file since preflight.
  assertComplete(
    await inventory(root, archivePath, true),
    await inventory(root, RESOURCE_DIR, false),
  );
  if (await state(old))
    throw conflict('an older writer recreated .verd-resources');
  await publish(
    root,
    markerPath,
    Buffer.from('{"version":1}\n'),
    migrationDirectory,
  );
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
