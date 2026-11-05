import type { FileWriteOp, WorkspaceEntryMeta } from './workspace-host';

export const FOLDER_ID_FILE = '.verd-folder.json';

export function isFolderIdentityPath(path: string): boolean {
  return path.split('/').at(-1) === FOLDER_ID_FILE;
}

export function readFolderIdentity(content: string): string | undefined {
  try {
    const value = JSON.parse(content);
    return value?.version === 1 &&
      typeof value.id === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.id)
      ? value.id
      : undefined;
  } catch {
    return undefined;
  }
}

export function folderIdentityWrite(path: string, id: string): FileWriteOp {
  return {
    path: `${path}/${FOLDER_ID_FILE}`,
    content: JSON.stringify({ version: 1, id }) + '\n',
    expectedVersion: null,
  };
}

export function findFoldersById(
  entries: readonly WorkspaceEntryMeta[],
  folderId: string,
) {
  return entries.filter(
    (entry) => entry.kind === 'directory' && entry.folderId === folderId,
  );
}
