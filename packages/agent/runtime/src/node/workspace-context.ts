import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceDirectoryContext } from '@sue/verd-board-workspace';
import { discoverWorkspaceRepository } from './workspace-git';

export const PROJECT_WORKSPACE_CONFIG_FILE = '.verd.config.json';

/** A project points to one content directory without storing machine-specific absolute paths. */
export async function resolveProjectWorkspace(
  projectRoot: string,
  workspacePath: string,
) {
  if (
    !workspacePath ||
    path.isAbsolute(workspacePath) ||
    workspacePath.includes('\\') ||
    workspacePath.includes('\0') ||
    workspacePath.split('/').includes('..')
  )
    throw new Error(
      'Project workspace must be a relative directory inside the project',
    );
  projectRoot = await fs.realpath(projectRoot);
  const root = await fs.realpath(path.resolve(projectRoot, workspacePath));
  const relative = path.relative(projectRoot, root);
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative) ||
    !(await fs.stat(root)).isDirectory()
  )
    throw new Error('Project workspace is outside the project directory');
  return root;
}

export async function configuredProjectWorkspace(
  projectRoot: string,
): Promise<string | null> {
  const config = await fs
    .readFile(path.join(projectRoot, PROJECT_WORKSPACE_CONFIG_FILE), 'utf8')
    .catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  if (config === null) return null;
  const value = JSON.parse(config) as { workspace?: unknown };
  if (typeof value.workspace !== 'string')
    throw new Error('.verd.config.json requires a workspace directory');
  return resolveProjectWorkspace(projectRoot, value.workspace);
}

export async function readWorkspaceDirectoryContext(
  root: string,
  explicitProjectRoot?: string,
): Promise<WorkspaceDirectoryContext> {
  root = await fs.realpath(root);
  const repository = await discoverWorkspaceRepository(root);
  let projectRoot = explicitProjectRoot
    ? await fs.realpath(explicitProjectRoot)
    : (repository?.root ?? root);
  if (!explicitProjectRoot) {
    let candidate = root;
    for (;;) {
      if (
        (await configuredProjectWorkspace(candidate).catch(() => null)) === root
      ) {
        projectRoot = candidate;
        break;
      }
      if (
        candidate === repository?.root ||
        path.dirname(candidate) === candidate
      )
        break;
      candidate = path.dirname(candidate);
    }
  }
  const workspacePath = path
    .relative(projectRoot, root)
    .split(path.sep)
    .join('/');
  if (
    workspacePath === '..' ||
    workspacePath.startsWith('../') ||
    path.isAbsolute(workspacePath)
  )
    throw new Error('Workspace is outside its project directory');
  return {
    workspaceRoot: root,
    projectRoot,
    workspacePath,
    repositoryRoot: repository?.root,
    repositoryPath: repository?.workspacePath,
  };
}
