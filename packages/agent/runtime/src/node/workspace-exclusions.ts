import * as fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeWorkspacePath } from '@sue/verd-board-workspace';

interface WorkspaceMapping {
  workspace?: unknown;
  exclude?: unknown;
}

/** Exclusions only affect the content index. The raw file API remains scoped to the actual root. */
export async function readProjectContentExclusions(
  root: string,
): Promise<ReadonlySet<string>> {
  const workspaceRoot = await fs.realpath(root).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (workspaceRoot === null) return new Set();

  let ancestor = workspaceRoot;
  for (;;) {
    const config = await fs
      .readFile(path.join(ancestor, '.verd.config.json'), 'utf8')
      .catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (config !== null) {
      const mapping = JSON.parse(config) as WorkspaceMapping;
      if (
        typeof mapping.workspace === 'string' &&
        (await fs.realpath(path.resolve(ancestor, mapping.workspace)).catch(() => null)) === workspaceRoot
      ) {
        if (mapping.exclude === undefined) return new Set();
        if (!Array.isArray(mapping.exclude) || mapping.exclude.some((file) => typeof file !== 'string'))
          throw new Error('Verd workspace exclusion paths must be strings');
        return new Set(mapping.exclude.map((file) => {
          if (path.isAbsolute(file)) throw new Error('Verd workspace exclusion must be relative');
          return normalizeWorkspacePath(file);
        }));
      }
    }
    const git = await fs.lstat(path.join(ancestor, '.git')).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const parent = path.dirname(ancestor);
    if (git || parent === ancestor) return new Set();
    ancestor = parent;
  }
}
