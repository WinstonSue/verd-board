import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import {
  createWorkspaceServiceTransport,
  createFsWorkspaceHost,
  createLocalWorkspaceManager,
  createBuiltinWorkspaceUpdater,
  initializePatternWorkspace,
} from '@sue/verd-board-agent/node';
import {
  normalizeWorkspacePath,
  type WorkspaceHandle,
} from '@sue/verd-board-app/headless';
import { type ServiceHostApi } from '../../../packages/product/app/src/host/service-protocol';
import { importBrowserBackup } from './migration';

export interface LocalServiceOptions {
  dataRoot: string;
  defaultRoot?: string;
  seedDefault?: boolean;
  builtinSource: string;
  patternSource: string;
  productVersion: string;
  sharedResources?: () => string | Promise<string>;
  webRoot?: string;
  allowedOrigins?: string[];
  leaseMs?: number;
  /** Optional filesystem boundary, used by isolated test and embedded hosts. */
  workspaceBoundary?: string;
  openPath?: (location: string) => Promise<void>;
}

const systemOpen = (location: string) =>
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
  });

export async function createLocalService(options: LocalServiceOptions) {
  await fs.mkdir(options.dataRoot, { recursive: true });
  const lock = path.join(options.dataRoot, '.service-lock');
  try {
    await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lock, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
    }
    if (alive) throw new Error('该 Web 数据目录已有运行中的 service');
    await fs.unlink(lock);
    await fs.writeFile(lock, String(process.pid), { flag: 'wx' });
  }
  const defaultRoot = () =>
    path.join(options.dataRoot, 'workspaces', 'default');
  const host = createFsWorkspaceHost({
    defaultRoot,
    globalConfigPath: () =>
      path.join(options.dataRoot, 'verdboard-global-config.json'),
    sharedResources: options.sharedResources,
  });
  host.capabilities = {
    pickWorkspace: true,
    openBuiltinWorkspace: !!options.builtinSource,
    openPatternWorkspace: !!options.patternSource,
  };
  const manager = createLocalWorkspaceManager({
    host,
    defaultRoot,
    builtinSource: () => options.builtinSource,
    appVersion: () => options.productVersion,
    explicitRoot: options.defaultRoot,
    seedDefault: options.seedDefault,
    pickDirectory: async () => null,
  });
  const updater = createBuiltinWorkspaceUpdater({
    host,
    userData: () => options.dataRoot,
    source: (kind) =>
      kind === 'project' ? options.builtinSource : options.patternSource,
    appVersion: () => options.productVersion,
    registerBackup: (root) => manager.rememberBackup(root),
  });
  const openPath = options.openPath ?? systemOpen;
  const rootFor = (handle: WorkspaceHandle) => {
    const workspace = host.workspaces.get(handle.key);
    if (!workspace) throw new Error('Workspace unavailable');
    return workspace.root;
  };
  async function checkedLocation(input: string) {
    const location = await fs.realpath(input);
    if (options.workspaceBoundary) {
      const boundary = await fs.realpath(options.workspaceBoundary);
      const relative = path.relative(boundary, location);
      if (
        relative === '..' ||
        relative.startsWith('..' + path.sep) ||
        path.isAbsolute(relative)
      )
        throw new Error('Location is outside this service workspace boundary');
    }
    return location;
  }
  async function browseDirectories(
    input = options.workspaceBoundary ?? os.homedir(),
  ) {
    const location = await checkedLocation(input);
    const entries = await fs.readdir(location, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    const parent =
      options.workspaceBoundary &&
      location === (await fs.realpath(options.workspaceBoundary))
        ? location
        : path.dirname(location);
    return {
      path: location,
      parent: parent === location ? null : parent,
      directories,
    };
  }
  const methods: ServiceHostApi = {
    readGlobalConfig: () => host.readGlobalConfig(),
    writeGlobalConfig: (value, version) =>
      host.writeGlobalConfig(value, version),
    async openWorkspace(request) {
      await updater.recover();
      if (request?.pick) throw new Error('Choose a directory before opening');
      if (options.workspaceBoundary && request?.path)
        await checkedLocation(request.path);
      if (request?.patterns) {
        const result = await initializePatternWorkspace(
          path.join(options.dataRoot, 'workspaces', 'agent-patterns'),
          {
            preserveExisting: true,
            appVersion: options.productVersion,
            source: options.patternSource,
          },
        );
        return manager.open({ path: result.path, name: '文档编写推荐库' });
      }
      return manager.open(request);
    },
    activateWorkspace: (h) => manager.activate(h),
    listWorkspaceHistory: () => manager.listHistory(),
    updateWorkspaceHistory: (request) => manager.updateHistory(request),
    createWorkspace: async (request) => {
      await checkedLocation(request.parentPath);
      return manager.create(request);
    },
    readWorkspaceLocation: async (h) => rootFor(h),
    revealWorkspaceLocation: (h) => openPath(rootFor(h)),
    readBuiltinUpdate: (h) => updater.info(h),
    revealBuiltinBackups: async (h) => openPath(await updater.backups(h)),
    async updateBuiltinWorkspace(h, id, updateOptions) {
      if (updateOptions?.backup && !updateOptions.backupParent)
        throw new Error('Backup directory is required');
      if (updateOptions?.backupParent)
        await checkedLocation(updateOptions.backupParent);
      const next = await updater.update(h, id, {
        backupParent: updateOptions?.backup
          ? updateOptions.backupParent
          : undefined,
      });
      return manager.open({ path: rootFor(next) });
    },
    readSnapshot: (h) => host.readSnapshot(h),
    initializeAgent: (h) => host.initializeAgent!(h),
    readFile: (h, relative) => host.readFile(h, relative),
    readResource: (h, key) => host.readResource(h, key),
    async openResourceExternal(h, relative) {
      const root = await fs.realpath(rootFor(h));
      const target = await fs.realpath(
        path.join(root, normalizeWorkspacePath(relative)),
      );
      const location = path.relative(root, target);
      if (
        !location ||
        location.startsWith('..' + path.sep) ||
        location === '..' ||
        path.isAbsolute(location) ||
        !(await fs.stat(target)).isFile()
      )
        throw new Error('Invalid resource path');
      normalizeWorkspacePath(location.split(path.sep).join('/'));
      await openPath(target);
    },
    commit: (h, request) => host.commit(h, request),
    resolveConflict: (h, request) => host.resolveConflict(h, request),
    closeWorkspace: (h) => host.closeWorkspace(h),
    versions: (h, request) => host.versions!(h, request),
    git: (h, request) => host.git!(h, request),
    browseDirectories,
    async makeDirectory(parent, name) {
      if (!name.trim() || name === '.' || name === '..' || /[/\\\0]/.test(name))
        throw new Error('Invalid directory name');
      const root = await checkedLocation(parent);
      await fs.mkdir(path.join(root, name));
      return browseDirectories(path.join(root, name));
    },
    importBrowserBackup: async (backup, parent) =>
      importBrowserBackup(
        backup,
        await checkedLocation(parent),
        options.dataRoot,
        manager,
        host,
      ),
  };
  const transport = createWorkspaceServiceTransport({
    host,
    methods,
    allowedOrigins: options.allowedOrigins,
    webRoot: options.webRoot,
    leaseMs: options.leaseMs,
    waitIdle: () => host.waitIdle(),
  });
  return {
    ...transport,
    host,
    async close() {
      await transport.close();
      await fs.unlink(lock);
    },
  };
}
