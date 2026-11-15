import type { GitVersionFile } from '../host/workspace-git';
import { assertGitContentPath } from '../host/workspace-git';
import { FOLDER_ID_FILE, readFolderIdentity } from '../host/folder-identity';
import { nativeFileIdentity, gitAssetReferences } from './tree';

export const inDirectory = (path: string, root: string) =>
  path.startsWith(root + '/');
export const folderIdentity = (file: GitVersionFile) =>
  file.path.endsWith('/' + FOLDER_ID_FILE)
    ? readFolderIdentity(new TextDecoder().decode(file.content))
    : undefined;
export function directoryRoot(
  files: readonly GitVersionFile[],
  id: string,
): string | undefined {
  const matches = files.filter((file) => folderIdentity(file) === id);
  if (matches.length > 1) throw new Error('Ambiguous directory identity');
  return matches[0]?.path.slice(0, -('/' + FOLDER_ID_FILE).length);
}
export function directoryId(
  files: readonly GitVersionFile[],
  path: string,
  id?: string,
): string | undefined {
  assertGitContentPath(path);
  const found = files.find((f) => f.path === path + '/' + FOLDER_ID_FILE);
  const actual = found && folderIdentity(found);
  if (found && !actual) throw new Error('Invalid directory identity');
  if (id && actual !== id) throw new Error('Directory identity changed');
  if (actual && directoryRoot(files, actual) !== path)
    throw new Error('Ambiguous directory identity');
  return actual;
}
export function directoryCreation(
  current: GitVersionFile[],
  base: GitVersionFile[],
  path: string,
  directories: string[],
  changed: string[],
) {
  assertGitContentPath(path);
  const id = directoryId(current, path);
  const oldRoot = id && directoryRoot(base, id);
  const metadata: GitVersionFile[] = [];
  for (const dir of new Set([
    path,
    ...directories.filter((dir) => inDirectory(dir, path)),
  ])) {
    if (!directoryId(current, dir))
      metadata.push({
        path: dir + '/' + FOLDER_ID_FILE,
        content: new TextEncoder().encode(
          JSON.stringify({ version: 1, id: crypto.randomUUID() }) + '\n',
        ),
      });
  }
  const paths = new Set(changed.filter((p) => inDirectory(p, path)));
  metadata.forEach((f) => paths.add(f.path));
  current
    .filter((f) => inDirectory(f.path, path) && folderIdentity(f))
    .forEach((f) => paths.add(f.path));
  // A directory move includes its old deletion half, never unrelated replacement bytes.
  if (oldRoot && oldRoot !== path)
    for (const file of base.filter((f) => inDirectory(f.path, oldRoot))) {
      if (current.some((f) => f.path === file.path))
        throw new Error('A different file occupies the old directory path');
      paths.add(file.path);
    }
  const ids = new Set(
    current
      .filter((f) => inDirectory(f.path, path))
      .map((f) => nativeFileIdentity(f.content))
      .filter(Boolean),
  );
  for (const file of base)
    if (
      ids.has(nativeFileIdentity(file.content)) &&
      !current.some((f) => f.path === file.path)
    )
      paths.add(file.path);
  return {
    paths: [...paths],
    metadata,
    requiresReview: [...paths].some((p) => !inDirectory(p, path)),
  };
}
export function directoryRestore(
  version: GitVersionFile[],
  current: GitVersionFile[],
  tracked: GitVersionFile[],
  path: string,
  folderId?: string,
) {
  const id = directoryId(current, path, folderId);
  if (!id)
    throw new Error(
      'Directory history begins with its first identified version',
    );
  const oldRoot = directoryRoot(version, id);
  if (!oldRoot) throw new Error('Directory does not exist in this version');
  const selected = version.filter((f) => inDirectory(f.path, oldRoot));
  const outside = current.filter((f) => !inDirectory(f.path, path));
  for (const file of selected) {
    const identity = nativeFileIdentity(file.content),
      folder = folderIdentity(file);
    if (
      outside.some(
        (f) =>
          (identity && nativeFileIdentity(f.content) === identity) ||
          (folder && folderIdentity(f) === folder),
      )
    )
      throw new Error(
        'Historical identity already exists outside this directory',
      );
  }
  const writes = selected.map((f) => ({
    ...f,
    path: path + f.path.slice(oldRoot.length),
  }));
  const target = new Set(writes.map((f) => f.path));
  const deletes = tracked
    .filter((f) => inDirectory(f.path, path) && !target.has(f.path))
    .map((f) => f.path);
  return { writes, deletes };
}

export function expandCreation(
  current: GitVersionFile[],
  base: GitVersionFile[],
  paths: string[],
) {
  const selected = new Set(paths);
  const ids = new Set(
    current
      .filter((f) => selected.has(f.path))
      .map((f) => nativeFileIdentity(f.content))
      .filter(Boolean),
  );
  for (const f of base)
    if (
      ids.has(nativeFileIdentity(f.content)) &&
      !current.some((c) => c.path === f.path)
    )
      selected.add(f.path);
  for (const f of current.filter((f) => selected.has(f.path)))
    for (const asset of gitAssetReferences(f.content)) selected.add(asset);
  return [...selected];
}
