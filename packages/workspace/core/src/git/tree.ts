import './buffer-shim';
import * as git from 'isomorphic-git';
import { parseAssetLink } from '@sue/board-common';
import type { GitVersionFile } from '../host/workspace-git';

// Keep the public adapter structural, without exposing dependency-specific types.
// These opaque callable slots accept both Node and virtual filesystem methods.
type GitFsMethod = CallableFunction;
interface GitFsMethods {
  readFile: GitFsMethod;
  writeFile: GitFsMethod;
  unlink: GitFsMethod;
  readdir: GitFsMethod;
  mkdir: GitFsMethod;
  rmdir: GitFsMethod;
  stat: GitFsMethod;
  lstat: GitFsMethod;
  readlink?: GitFsMethod;
  symlink?: GitFsMethod;
  chmod?: GitFsMethod;
}
export type GitFs = GitFsMethods | { promises: GitFsMethods };
export interface GitLocation {
  fs: GitFs;
  dir: string;
  gitdir?: string;
}
export const decodeGitText = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes);
export const encodeGitText = (text: string): Uint8Array =>
  new TextEncoder().encode(text);

export function nativeFileIdentity(bytes: Uint8Array): string | undefined {
  try {
    const value = JSON.parse(decodeGitText(bytes));
    return value?.format === 'verd-document' && typeof value.id === 'string'
      ? value.id
      : value?.format === 'verd-frame' && typeof value.frame?.id === 'string'
        ? value.frame.id
        : undefined;
  } catch {
    return undefined;
  }
}

export function gitAssetReferences(bytes: Uint8Array): Set<string> {
  const result = new Set<string>();
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (key === 'src' && value.startsWith('verd-asset:')) {
        const path = value
          .slice(11)
          .replace(
            /^\.verd-resources\/assets\//,
            '.verdscrolls/resources/assets/',
          );
        if (/^\.verdscrolls\/resources\/assets\/[a-zA-Z0-9._-]+$/.test(path))
          result.add(path);
      } else if (key === 'href' || key === 'link') {
        const target = parseAssetLink(value);
        if (target)
          result.add('.verdscrolls/resources/assets/' + target.assetId);
      }
    } else if (value && typeof value === 'object')
      Object.entries(value).forEach(([key, child]) => visit(child, key));
  };
  try {
    visit(JSON.parse(decodeGitText(bytes)));
  } catch {
    /* Binary and plain files have no native resource references. */
  }
  return result;
}

export async function readGitTree(
  location: GitLocation,
  oid: string,
): Promise<GitVersionFile[]> {
  const output: GitVersionFile[] = [];
  const visit = async (tree: string, prefix: string) => {
    for (const entry of (await git.readTree({ ...location, oid: tree })).tree) {
      const path = prefix + entry.path;
      if (entry.type === 'tree') await visit(entry.oid, path + '/');
      else if (entry.type === 'blob')
        output.push({
          path,
          mode: entry.mode,
          content: (await git.readBlob({ ...location, oid: entry.oid })).blob,
        });
      else throw new Error(`Submodules are not supported: ${path}`);
    }
  };
  await visit(oid, '');
  return output;
}

export async function writeGitTree(
  location: GitLocation,
  files: readonly GitVersionFile[],
): Promise<string> {
  interface Directory {
    files: GitVersionFile[];
    dirs: Map<string, Directory>;
  }
  const root: Directory = { files: [], dirs: new Map() };
  for (const file of files) {
    const parts = file.path.split('/');
    const name = parts.pop()!;
    let node = root;
    for (const part of parts) {
      let child = node.dirs.get(part);
      if (!child) {
        child = { files: [], dirs: new Map() };
        node.dirs.set(part, child);
      }
      node = child;
    }
    node.files.push({ ...file, path: name });
  }
  const write = async (node: Directory): Promise<string> => {
    const tree: Parameters<typeof git.writeTree>[0]['tree'] = [];
    for (const file of node.files)
      tree.push({
        path: file.path,
        mode: file.mode ?? '100644',
        type: 'blob',
        oid: await git.writeBlob({ ...location, blob: file.content }),
      });
    for (const [path, directory] of node.dirs)
      tree.push({
        path,
        mode: '040000',
        type: 'tree',
        oid: await write(directory),
      });
    return git.writeTree({ ...location, tree });
  };
  return write(root);
}
