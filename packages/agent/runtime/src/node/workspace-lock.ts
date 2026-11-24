import * as fs from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalRoot,
  digest,
  withWorkspaceLock,
} from '@sue/verd-board-file-workspace';
import { readProjectContentExclusions } from './workspace-exclusions';
import { readWorkspaceSkillsUnlocked } from './workspace-skills';
import {
  FOLDER_ID_FILE,
  isProjectInternalPath,
  readFolderIdentity,
  type NativeWorkspaceEntry,
  type AuthoringDiagnostic,
} from '@sue/verd-board-workspace';

export {
  createSerialQueue,
  digest,
  withWorkspaceLock,
} from '@sue/verd-board-file-workspace';

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
  directories?: { path: string; folderId?: string }[];
  resourceFound?: boolean;
}
/** Caller must hold the common workspace lock. Does not create metadata or recover. */
export async function readNativeSnapshotUnlocked(
  root: string,
  focus?: { directories?: boolean; resourcePath?: string },
): Promise<NativeSnapshot> {
  root = await canonicalRoot(root);
  const entries: NativeSnapshot['entries'] = [],
    diagnostics: AuthoringDiagnostic[] = [];
  const manifest: [string, string][] = [];
  const folderIds: string[] = [];
  const directories: NativeSnapshot['directories'] = focus?.directories
    ? []
    : undefined;
  let resourceFound = false;
  const excluded = await readProjectContentExclusions(root);
  async function walk(dir: string) {
    const children = await fs
      .readdir(path.join(root, dir), { withFileTypes: true })
      .catch((error) => {
        if (error.code === 'ENOENT' && !dir) return [];
        throw error;
      });
    const marker = children.find((child) => child.name === FOLDER_ID_FILE);
    let folderId: string | undefined;
    if (dir && marker?.isFile()) {
      const relative = `${dir}/${FOLDER_ID_FILE}`;
      const bytes = await fs.readFile(path.join(root, relative), 'utf8');
      folderId = readFolderIdentity(bytes);
      if (folderId) folderIds.push(folderId);
      manifest.push([relative, digest(bytes)]);
    }
    if (dir) directories?.push({ path: dir, folderId });
    for (const child of children.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (
        isProjectInternalPath(child.name) ||
        ['.git', '.agents'].includes(child.name)
      )
        continue;
      const relative = dir ? `${dir}/${child.name}` : child.name;
      if (excluded.has(relative)) continue;
      if (child.isDirectory()) await walk(relative);
      else if (/\.verd(?:(?:-doc)?\.json)?$/.test(child.name)) {
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
      } else if (relative === focus?.resourcePath && child.isFile()) {
        resourceFound = true;
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
    ...(directories && { directories }),
    ...(focus?.resourcePath && { resourceFound }),
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
export const readNativeSnapshot = (
  root: string,
  focus?: Parameters<typeof readNativeSnapshotUnlocked>[1],
) => withWorkspaceLock(root, () => readNativeSnapshotUnlocked(root, focus));
