import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import {
  normalizeWorkspacePath,
  type ServiceHostApi,
  type WorkspaceHost,
} from '@sue/verd-board-workspace';
import { createFsWorkspaceHost } from './workspace-host-fs';
import {
  configuredProjectWorkspace,
  resolveProjectWorkspace,
} from './workspace-context';
import { createWorkspaceServiceTransport } from './workspace-service-transport';

export interface ProjectWorkspaceServiceOptions {
  projectRoot: string;
  /** Relative to projectRoot; defaults to the workspace in .verd.config.json. */
  workspacePath?: string;
  /** Personal configuration stays outside the portable project configuration. */
  dataRoot?: string;
  apiPath?: string;
  allowedOrigins?: string[];
  sharedResources?: () => string | Promise<string>;
  openPath?: (location: string) => Promise<void>;
}

export interface ProjectWorkspaceService {
  workspaceRoot: string;
  projectRoot: string;
  host: WorkspaceHost;
  server: Server;
  handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean>;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

/** Mount the desktop workspace model on a project's existing local Node server. */
export async function createProjectWorkspaceService(
  options: ProjectWorkspaceServiceOptions,
): Promise<ProjectWorkspaceService> {
  const projectRoot = await fs.realpath(options.projectRoot);
  const workspaceRoot = options.workspacePath
    ? await resolveProjectWorkspace(projectRoot, options.workspacePath)
    : await configuredProjectWorkspace(projectRoot);
  if (!workspaceRoot)
    throw new Error(
      'Specify workspacePath or a workspace in .verd.config.json',
    );
  const dataRoot =
    options.dataRoot ??
    path.join(
      os.homedir(),
      '.verdscrolls',
      'projects',
      createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 32),
    );
  const host = createFsWorkspaceHost({
    defaultRoot: () => workspaceRoot,
    globalConfigPath: () => path.join(dataRoot, 'config.json'),
    projectRoot,
    sessionNamespace: 'project-web',
    sharedResources: options.sharedResources,
  });
  host.capabilities = {
    pickWorkspace: false,
    openBuiltinWorkspace: false,
    openPatternWorkspace: false,
  };
  const openPath =
    options.openPath ??
    ((location: string) =>
      new Promise<void>((resolve, reject) => {
        const command =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'explorer.exe'
              : 'xdg-open';
        execFile(command, [location], (error) =>
          error ? reject(error) : resolve(),
        );
      }));
  const unsupported = async (): Promise<never> => {
    throw new Error(
      'This project service is fixed to its configured workspace',
    );
  };
  const methods: Partial<ServiceHostApi> = {
    readGlobalConfig: () => host.readGlobalConfig(),
    writeGlobalConfig: (value, version) =>
      host.writeGlobalConfig(value, version),
    async openWorkspace(request = {}) {
      if (request.pick || request.historyId || request.patterns)
        return unsupported();
      if (
        request.path &&
        (await fs.realpath(path.resolve(projectRoot, request.path))) !==
          workspaceRoot
      )
        return unsupported();
      return host.openWorkspace({
        path: workspaceRoot,
        create: request.create,
        name: request.name,
      });
    },
    activateWorkspace: async () => {},
    listWorkspaceHistory: async () => [],
    updateWorkspaceHistory: unsupported,
    createWorkspace: unsupported,
    readWorkspaceLocation: async () => workspaceRoot,
    revealWorkspaceLocation: () => openPath(workspaceRoot),
    readBuiltinUpdate: async () => null,
    revealBuiltinBackups: unsupported,
    updateBuiltinWorkspace: unsupported,
    readSnapshot: (h) => host.readSnapshot(h),
    initializeAgent: (h) => host.initializeAgent!(h),
    readFile: (h, file) => host.readFile(h, file),
    readResource: (h, key) => host.readResource(h, key),
    async openResourceExternal(_handle, relative) {
      const target = await fs.realpath(
        path.join(workspaceRoot, normalizeWorkspacePath(relative)),
      );
      normalizeWorkspacePath(
        path.relative(workspaceRoot, target).split(path.sep).join('/'),
      );
      if (!(await fs.stat(target)).isFile())
        throw new Error('Not an ordinary file');
      await openPath(target);
    },
    commit: (h, request) => host.commit(h, request),
    resolveConflict: (h, request) => host.resolveConflict(h, request),
    closeWorkspace: (h) => host.closeWorkspace(h),
    versions: (h, request) => host.versions(h, request),
    git: (h, request) => host.git!(h, request),
  };
  return {
    ...createWorkspaceServiceTransport({
      host,
      methods,
      apiPath: options.apiPath,
      allowedOrigins: options.allowedOrigins,
      waitIdle: () => host.waitIdle(),
    }),
    workspaceRoot,
    projectRoot,
    host,
  };
}
