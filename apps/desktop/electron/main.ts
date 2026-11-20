import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createExternalFileHost } from './external-file-host';
import {
  launchFiles,
  supportedDesktopFile,
  setDefaultFileApplications,
} from './file-associations';
import type { WorkspaceFile } from '@sue/verd-board-app/headless';
import { realpath, stat } from 'node:fs/promises';
import { normalizeWorkspacePath } from '@sue/verd-board-app/headless';
import { createBuiltinWorkspaceUpdater } from './builtin-workspace-update';
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import * as path from 'path';
import { configureApplicationIdentity } from './application-identity';
import {
  contentSecurityPolicy,
  shouldAttachContentSecurityPolicy,
} from './content-security-policy';
import { createFullscreenTransition } from './fullscreen-transition';
import { resolveStoragePath, STORAGE_FILE } from './migrate-storage';
import { createShutdownCoordinator } from './shutdown';
import {
  archiveAndReplaceStorage,
  clearStorage,
  createSerialQueue,
  getStorageValue,
  listStorageKeys,
  removeStorageValue,
  setStorageValue,
} from './storage-file';
import {
  createFsWorkspaceHost,
  initializePatternWorkspace,
  deployAgentResources,
} from './workspace-host-fs';
import { createDesktopWorkspaceManager } from './workspace-startup';

const { legacyUserDataRoot } = configureApplicationIdentity(app);
const interactiveDev =
  !app.isPackaged && process.env['VERDBOARD_INTERACTIVE_DEV'] === '1';
if (interactiveDev || app.isPackaged) {
  if (!app.requestSingleInstanceLock()) {
    if (interactiveDev)
      console.error('[VerdBoard Dev] 该开发数据目录已有实例，请先退出原实例。');
    process.exit(0);
  }

  // A stopped or crashed Vite owner closes the inherited IPC channel.
  // Use the regular quit path so the renderer can flush pending edits.
  if (interactiveDev && process.connected)
    process.once('disconnect', () => app.quit());
}
const applicationIcon = path.join(
  __dirname,
  app.isPackaged ? '../build/icon.png' : '../build/icon-dev.png',
);

let mainWindow: BrowserWindow | null = null;
type ExternalHost = Awaited<ReturnType<typeof createExternalFileHost>>;
interface WindowRecord {
  window: BrowserWindow;
  external?: ExternalHost;
  handles: Set<string>;
  activeHandle?: string;
  pendingPaths?: string[];
  initialWorkspace?: Promise<void>;
  completeWorkspaceOpen?(): void;
  fullscreenReady(): Promise<void>;
  ready: boolean;
  pendingQuit?: { id: number; complete(ok: boolean, message?: string): void };
}
const windows = new Map<number, WindowRecord>();
const pendingFiles: string[] = [];
let fileQueue: Promise<unknown> = Promise.resolve();
let allowQuit = false;
let quitSequence = -1;
const focusWindow = (window: BrowserWindow) => {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

let quitting = false;
app.on('before-quit', (event) => {
  if (allowQuit) return;
  const records = [...windows.values()];
  if (!records.some((record) => record.ready)) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void Promise.all(
    records.map((record) =>
      record.ready
        ? new Promise<string | null>((resolve) => {
            const id = quitSequence--;
            record.pendingQuit = {
              id,
              complete(ok, message) {
                record.pendingQuit = undefined;
                resolve(ok ? null : message || '文件保存失败');
              },
            };
            record.window.webContents.send('workspace:flush-request', id);
          })
        : Promise.resolve(null),
    ),
  ).then(async (results) => {
    quitting = false;
    const failures = results.filter((result) => result !== null);
    if (failures.length) {
      for (const record of windows.values())
        record.window.webContents.send('files:resume');
      await dialog.showMessageBox({
        type: 'error',
        title: '保存失败',
        message: '仍有文件尚未保存，窗口保持打开。',
        detail: failures.join('\n'),
      });
    } else {
      allowQuit = true;
      app.quit();
    }
  });
});
let storagePath: string;
const enqueueStorageWrite = createSerialQueue();

/**
 * File-per-workspace host shared by every window; the renderer only ever
 * holds opaque handle keys and workspace-relative paths.
 */
const defaultWorkspaceRoot = () =>
  path.join(app.getPath('userData'), 'workspaces', 'default');
const pickWorkspaceDirectory = async () => {
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择工作区文件夹',
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
};
let agentResources: Promise<string> | undefined;
const workspaceHost = createFsWorkspaceHost({
  defaultRoot: defaultWorkspaceRoot,
  globalConfigPath: () =>
    path.join(app.getPath('userData'), 'verdboard-global-config.json'),
  pickDirectory: pickWorkspaceDirectory,
  sharedResources: () => {
    agentResources ??= deployAgentResources(
      app.isPackaged
        ? path.join(process.resourcesPath, 'agent-tools')
        : (process.env['VERD_AGENT_RESOURCES'] ??
            path.resolve(
              __dirname,
              `../build/agent-resources/${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'}-${process.arch}`,
            )),
      path.join(app.getPath('userData'), 'agent-resources'),
    ).catch((error) => {
      agentResources = undefined;
      throw error;
    });
    return agentResources;
  },
});
const workspaceManager = createDesktopWorkspaceManager({
  host: workspaceHost,
  defaultRoot: defaultWorkspaceRoot,
  builtinSource: () =>
    !app.isPackaged && process.env['VERDBOARD_BUILTIN_WORKSPACE_PATH']
      ? path.resolve(process.env['VERDBOARD_BUILTIN_WORKSPACE_PATH'])
      : app.isPackaged
        ? path.join(process.resourcesPath, 'workspace')
        : path.resolve(__dirname, '../../../workspace'),
  legacyStorage: () => storagePath,
  legacyUserDataRoot,
  appVersion: () =>
    JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'))
      .version,
  explicitRoot: process.env['VERDBOARD_WORKSPACE_PATH'],
  pickDirectory: pickWorkspaceDirectory,
});

const contentSource = (kind: 'project' | 'agent-patterns') =>
  kind === 'project' &&
  !app.isPackaged &&
  process.env['VERDBOARD_BUILTIN_WORKSPACE_PATH']
    ? path.resolve(process.env['VERDBOARD_BUILTIN_WORKSPACE_PATH'])
    : app.isPackaged
      ? path.join(
          process.resourcesPath,
          kind === 'project' ? 'workspace' : kind,
        )
      : path.resolve(
          __dirname,
          kind === 'project'
            ? '../../../workspace'
            : '../../../packages/agent/patterns/workspace',
        );
const productVersion = JSON.parse(
  readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
).version as string;
const builtinUpdater = createBuiltinWorkspaceUpdater({
  host: workspaceHost,
  userData: () => app.getPath('userData'),
  appVersion: () => productVersion,
  source: contentSource,
  registerBackup: (root) => workspaceManager.rememberBackup(root),
});

function trustedSender(
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
) {
  const record = windows.get(event.sender.id);
  return !!record && event.senderFrame === record.window.webContents.mainFrame;
}
const handleTrusted: typeof ipcMain.handle = (channel, listener) =>
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) throw new Error('Untrusted IPC frame');
    const record = windows.get(event.sender.id)!;
    if (record.external && channel.startsWith('storage:'))
      throw new Error(
        'External windows cannot access legacy workspace storage',
      );
    if (channel.startsWith('workspace-host:')) {
      if (record.external)
        throw new Error('External windows cannot access workspace hosts');
      const handle = args[0] as { key?: string } | undefined;
      if (handle?.key && !record.handles.has(handle.key))
        throw new Error('Workspace handle not issued to this window');
    }
    let result;
    try {
      result = await listener(event, ...args);
    } catch (error) {
      if (channel === 'workspace-host:open') record.completeWorkspaceOpen?.();
      throw error;
    }
    if (channel === 'workspace-host:activate')
      record.activeHandle = (args[0] as { key: string }).key;
    if (channel === 'workspace-host:close')
      record.handles.delete((args[0] as { key: string }).key);
    if (
      channel.startsWith('workspace-host:') &&
      result &&
      typeof result === 'object' &&
      'key' in result
    )
      record.handles.add(String(result.key));
    if (channel === 'workspace-host:open') {
      if (result && typeof result === 'object' && 'key' in result)
        record.activeHandle ??= String(result.key);
      record.completeWorkspaceOpen?.();
    }
    return result;
  });

const workspaceSubscriptions = new Map<number, Map<string, () => void>>();

async function configureDefaultApplications() {
  if (!app.isPackaged)
    throw new Error('请在已安装的正式应用中设置默认打开方式');
  await setDefaultFileApplications({
    platform: process.platform,
    executable: process.execPath,
    resources: process.resourcesPath,
    home: app.getPath('home'),
    openSettings: (url) => shell.openExternal(url),
  });
}

async function promptDefaultApplications() {
  if (!app.isPackaged) return;
  const marker = path.join(app.getPath('userData'), 'file-associations.json');
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(marker, JSON.stringify({ prompted: true }), {
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    console.error('Unable to record file association prompt', error);
    return;
  }
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '默认打开方式',
    message: '使用 VerdBoard 打开 Markdown 和 .verd 画布文件？',
    detail: '系统可能要求你确认默认应用。也可以稍后在设置或文件窗口中设置。',
    buttons: ['设置默认打开方式', '暂不设置'],
    defaultId: 0,
    cancelId: 1,
  });
  if (result.response === 0) {
    try {
      await configureDefaultApplications();
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: '未能设置默认打开方式',
        detail: String(error),
      });
    }
  }
}

function openDesktopFiles(paths: string[]) {
  const run = async () => {
    const failures: string[] = [];
    for (const input of paths) {
      try {
        if (!supportedDesktopFile(input)) continue;
        const source = await realpath(input);
        for (const record of windows.values()) {
          if (
            record.external ||
            record.activeHandle ||
            !record.initialWorkspace
          )
            continue;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              record.initialWorkspace,
              new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('工作区仍在启动，请稍后重试打开文件')),
                  30_000,
                ).unref();
              }),
            ]);
          } finally {
            clearTimeout(timeout);
          }
        }
        const existing = [...windows.values()].find(
          (record) => record.external?.source === source,
        );
        if (existing) {
          focusWindow(existing.window);
          continue;
        }
        let owner: WindowRecord | undefined;
        let relative = '';
        if (/\.verd(?:\.json)?$/i.test(source)) {
          for (const record of windows.values()) {
            for (const key of record.activeHandle
              ? [record.activeHandle]
              : []) {
              const workspace = workspaceHost.workspaces.get(key);
              if (!workspace) continue;
              const root = await realpath(workspace.root);
              const candidate = path.relative(root, source);
              if (
                candidate &&
                candidate !== '..' &&
                !candidate.startsWith('..' + path.sep) &&
                !path.isAbsolute(candidate)
              ) {
                owner = record;
                relative = candidate.split(path.sep).join('/');
                break;
              }
            }
            if (owner) break;
          }
        }
        if (owner) {
          (owner.pendingPaths ??= []).push(relative);
          owner.window.webContents.send('files:workspace-file');
          focusWindow(owner.window);
        } else {
          const external = await createExternalFileHost(
            source,
            path.join(app.getPath('userData'), 'external-files'),
          );
          createWindow(external);
        }
      } catch (error) {
        failures.push(`${path.basename(input)}: ${String(error)}`);
      }
    }
    if (!windows.size) createWindow();
    if (failures.length)
      void dialog
        .showMessageBox({
          type: 'error',
          title: '打开文件失败',
          message: '部分文件未能打开，其他文件已继续处理。',
          detail: failures.join('\n'),
        })
        .catch((error) => console.error('Unable to show file errors', error));
  };
  const result = fileQueue.then(run, run);
  fileQueue = result.catch(() => {});
  return result;
}

let filesReady = false;
app.on('open-file', (event, filename) => {
  event.preventDefault();
  if (filesReady) void openDesktopFiles([filename]);
  else pendingFiles.push(filename);
});
app.on('second-instance', (_event, argv, workingDirectory) => {
  const paths = launchFiles(
    argv.slice(app.isPackaged ? 1 : 2),
    workingDirectory,
  );
  if (!filesReady) pendingFiles.push(...paths);
  else if (paths.length) void openDesktopFiles(paths);
  else if (mainWindow) focusWindow(mainWindow);
});

function registerExternalFileIpc() {
  const externalFor = (event: Electron.IpcMainInvokeEvent) => {
    const external = windows.get(event.sender.id)?.external;
    if (!external) throw new Error('Not an external file window');
    return external;
  };
  handleTrusted(
    'files:binding',
    (event) => windows.get(event.sender.id)?.external?.binding ?? null,
  );
  handleTrusted('files:workspace-pending', (event) => {
    const record = windows.get(event.sender.id)!;
    const pending = record.pendingPaths ?? [];
    record.pendingPaths = [];
    return pending;
  });
  handleTrusted('files:defaults', configureDefaultApplications);
  handleTrusted('files:warnings', (event) => externalFor(event).warnings());
  handleTrusted('files:image', (event, href) =>
    externalFor(event).readImage(href),
  );
  handleTrusted('files:link', async (event, href: string) => {
    const external = externalFor(event);
    const target = new URL(href, pathToFileURL(external.source));
    if (target.protocol === 'file:') {
      const filename = fileURLToPath(target);
      if (!supportedDesktopFile(filename))
        throw new Error('不支持的本地链接类型');
      await openDesktopFiles([filename]);
    } else if (
      ['https:', 'http:'].includes(target.protocol) &&
      !target.username &&
      !target.password
    )
      await shell.openExternal(target.href);
    else throw new Error('不支持的链接');
  });
  handleTrusted(
    'files:resolve',
    async (
      event,
      action: string,
      local: { file: WorkspaceFile; path: string }[],
    ) => {
      const external = externalFor(event);
      if (action === 'load-disk') {
        await external.host.readSnapshot(external.binding.handle);
        return true;
      }
      if (action === 'keep-local') {
        const receipt = await external.overwrite(local);
        if (receipt.outcome !== 'applied')
          throw new Error('原文件再次发生变化，请重试');
        return true;
      }
      if (action !== 'save-copy') throw new Error('Unknown conflict action');
      const result = await dialog.showSaveDialog(
        windows.get(event.sender.id)!.window,
        {
          defaultPath: path.join(
            path.dirname(external.source),
            external.binding.kind === 'markdown'
              ? path
                  .basename(external.source)
                  .replace(/(\.(?:md|markdown))$/i, ' 副本$1')
              : path
                  .basename(external.source)
                  .replace(/\.verd(?:\.json)?$/i, ' 副本.verd'),
          ),
          filters: [
            {
              name:
                external.binding.kind === 'markdown'
                  ? 'Markdown'
                  : 'VerdBoard canvas',
              extensions:
                external.binding.kind === 'markdown'
                  ? [path.extname(external.source).slice(1)]
                  : ['verd'],
            },
          ],
        },
      );
      if (result.canceled || !result.filePath) return false;
      await external.saveCopy(result.filePath, local);
      return true;
    },
  );
  handleTrusted('file-host:snapshot', (event, h) =>
    externalFor(event).host.readSnapshot(h),
  );
  handleTrusted('file-host:read-file', (event, h, p) =>
    externalFor(event).host.readFile(h, p),
  );
  handleTrusted('file-host:read-resource', (event, h, p) =>
    externalFor(event).host.readResource(h, p),
  );
  handleTrusted('file-host:commit', (event, h, request) =>
    externalFor(event).host.commit(h, request),
  );
  handleTrusted('file-host:resolve-conflict', (event, h, request) =>
    externalFor(event).host.resolveConflict(h, request),
  );
  handleTrusted('file-host:close', (event, h) =>
    externalFor(event).host.closeWorkspace(h),
  );
  ipcMain.on('file-host:subscribe', (event, h, subId: string) => {
    if (!trustedSender(event) || typeof subId !== 'string') return;
    const external = windows.get(event.sender.id)?.external;
    if (!external || h?.key !== external.binding.handle.key) return;
    const unsubscribe = external.host.subscribe(h, (hint) => {
      if (!event.sender.isDestroyed())
        event.sender.send(`file-host:change:${subId}`, hint);
    });
    let subscriptions = workspaceSubscriptions.get(event.sender.id);
    if (!subscriptions) {
      subscriptions = new Map();
      workspaceSubscriptions.set(event.sender.id, subscriptions);
    }
    subscriptions.get(subId)?.();
    subscriptions.set(subId, unsubscribe);
  });
  ipcMain.on('file-host:unsubscribe', (event, subId: string) => {
    if (!trustedSender(event)) return;
    const subscriptions = workspaceSubscriptions.get(event.sender.id);
    subscriptions?.get(subId)?.();
    subscriptions?.delete(subId);
  });
}

function registerWorkspaceHostIpc() {
  handleTrusted('link:external', async (_event, href: string) => {
    const url = new URL(href);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Invalid external URL');
    await shell.openExternal(url.href);
  });
  handleTrusted('pdf:asset', async (_event, kind: string, filename: string) => {
    const folders: Record<string, string> = {
      worker: '',
      cMapUrl: 'cmaps',
      standardFontDataUrl: 'standard_fonts',
      wasmUrl: 'wasm',
    };
    if (
      !(kind in folders) ||
      !/^[a-zA-Z0-9_.-]+$/.test(filename) ||
      filename.includes('..') ||
      (kind === 'worker' && filename !== 'pdf.worker.min.mjs')
    )
      throw new Error('Invalid PDF asset');
    const root = !process.env['VITE_DEV_SERVER_URL']
      ? path.join(__dirname, '../dist/pdf-assets')
      : path.dirname(
          require.resolve('pdfjs-dist/package.json', {
            paths: [path.resolve(__dirname, '../../../packages/product/app')],
          }),
        );
    const folder =
      !!process.env['VITE_DEV_SERVER_URL'] && kind === 'worker'
        ? 'legacy/build'
        : folders[kind];
    return new Uint8Array(readFileSync(path.join(root, folder, filename)));
  });
  const workspaceRoot = (handle: { key: string }) => {
    const workspace = workspaceHost.workspaces.get(handle.key);
    if (!workspace) throw new Error('Workspace unavailable');
    return workspace.root;
  };
  handleTrusted('workspace-host:location', (_, h) => workspaceRoot(h));
  handleTrusted('workspace-host:reveal-location', async (_, h) => {
    const error = await shell.openPath(workspaceRoot(h));
    if (error) throw new Error(error);
  });
  handleTrusted('workspace-host:builtin-info', (_, h) =>
    builtinUpdater.info(h),
  );
  handleTrusted('workspace-host:builtin-update', async (_, h, id, options) => {
    let backupParent: string | undefined;
    if (options?.backup === true) {
      const picked = await pickWorkspaceDirectory();
      if (!picked) return null;
      backupParent = picked;
    }
    const next = await builtinUpdater.update(h, id, { backupParent });
    return workspaceManager.open({ path: workspaceRoot(next) });
  });
  handleTrusted('workspace-host:builtin-backups', async (_, h) => {
    const error = await shell.openPath(await builtinUpdater.backups(h));
    if (error) throw new Error(error);
  });
  handleTrusted('workspace-host:read-global-config', () =>
    workspaceHost.readGlobalConfig(),
  );
  handleTrusted(
    'workspace-host:write-global-config',
    (_, value: Record<string, unknown>, expectedVersion: number) =>
      workspaceHost.writeGlobalConfig(value, expectedVersion),
  );
  handleTrusted('workspace-host:open', async (_, request) => {
    await builtinUpdater.recover();
    return request?.patterns
      ? initializePatternWorkspace(
          path.join(app.getPath('userData'), 'workspaces', 'agent-patterns'),
          {
            preserveExisting: true,
            appVersion: productVersion,
            source: app.isPackaged
              ? path.join(process.resourcesPath, 'agent-patterns')
              : path.resolve(
                  __dirname,
                  '../../../packages/agent/patterns/workspace',
                ),
          },
        ).then((result) =>
          workspaceManager.open({ path: result.path, name: '文档编写推荐库' }),
        )
      : workspaceManager.open(request);
  });
  handleTrusted('workspace-host:activate', (_, handle) =>
    workspaceManager.activate(handle),
  );
  handleTrusted('workspace-host:create', (_, request) =>
    workspaceManager.create(request),
  );
  handleTrusted('workspace-host:update-history', (_, request) =>
    workspaceManager.updateHistory(request),
  );
  handleTrusted('workspace-host:history', () => workspaceManager.listHistory());
  handleTrusted('workspace-host:snapshot', (_, handle) =>
    workspaceHost.readSnapshot(handle),
  );
  handleTrusted('workspace-host:initialize-agent', (_, handle) =>
    workspaceHost.initializeAgent!(handle),
  );
  handleTrusted('workspace-host:read-file', (_, handle, path: string) =>
    workspaceHost.readFile(handle, path),
  );
  handleTrusted('workspace-host:read-resource', (_, handle, key: string) =>
    workspaceHost.readResource(handle, key),
  );
  handleTrusted(
    'workspace-host:open-resource',
    async (_, handle, relative: string) => {
      const root = await realpath(workspaceRoot(handle));
      const target = await realpath(
        path.join(root, normalizeWorkspacePath(relative)),
      );
      const location = path.relative(root, target);
      if (
        !location ||
        location === '..' ||
        location.startsWith('..' + path.sep) ||
        path.isAbsolute(location) ||
        !(await stat(target)).isFile()
      )
        throw new Error('Invalid resource path');
      normalizeWorkspacePath(location.split(path.sep).join('/'));
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    },
  );
  handleTrusted('workspace-host:commit', (_, handle, request) =>
    workspaceHost.commit(handle, request),
  );
  handleTrusted('workspace-host:versions', async (_, handle, request) => {
    try {
      return await workspaceHost.versions!(handle, request);
    } catch (error) {
      return {
        versionError: {
          code:
            error && typeof error === 'object' && 'code' in error
              ? error.code
              : 'unsupported',
          diagnostic:
            error && typeof error === 'object' && 'diagnostic' in error
              ? String(error.diagnostic)
              : String(error),
        },
      };
    }
  });
  handleTrusted('workspace-host:git', (_, handle, request) => {
    if (!workspaceHost.git)
      throw new Error('Git workspace host is unavailable');
    return workspaceHost.git(handle, request);
  });
  handleTrusted('workspace-host:resolve-conflict', (_, handle, request) =>
    workspaceHost.resolveConflict(handle, request),
  );
  handleTrusted('workspace-host:close', (_, handle) =>
    workspaceHost.closeWorkspace(handle),
  );
  ipcMain.on(
    'workspace-host:subscribe',
    (event, handle: { key: string }, subId: string) => {
      if (typeof subId !== 'string' || !handle?.key) return;
      if (!trustedSender(event)) return;
      const record = windows.get(event.sender.id)!;
      if (record.external || !record.handles.has(handle.key)) return;
      const sender = event.sender;
      const unsub = workspaceHost.subscribe(handle as never, (hint) => {
        if (!sender.isDestroyed())
          sender.send(`workspace-host:change:${subId}`, hint);
      });
      let subs = workspaceSubscriptions.get(sender.id);
      if (!subs) {
        subs = new Map();
        workspaceSubscriptions.set(sender.id, subs);
        sender.once('destroyed', () => {
          workspaceSubscriptions.get(sender.id)?.forEach((fn) => fn());
          workspaceSubscriptions.delete(sender.id);
        });
      }
      subs.set(subId, unsub);
    },
  );
  ipcMain.on(
    'workspace-host:unsubscribe',
    (event, _handle: { key: string }, subId: string) => {
      if (!trustedSender(event)) return;
      const subs = workspaceSubscriptions.get(event.sender.id);
      subs?.get(subId)?.();
      subs?.delete(subId);
    },
  );
}

function installContentSecurityPolicy(devServerUrl?: string) {
  const policy = contentSecurityPolicy(devServerUrl);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (
      !shouldAttachContentSecurityPolicy(
        details.url,
        details.resourceType,
        devServerUrl,
      )
    ) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const responseHeaders = { ...details.responseHeaders };
    for (const key of Object.keys(responseHeaders)) {
      if (key.toLowerCase() === 'content-security-policy') {
        delete responseHeaders[key];
      }
    }
    responseHeaders['Content-Security-Policy'] = [policy];
    callback({ responseHeaders });
  });
}

function createWindow(external?: ExternalHost) {
  const window = new BrowserWindow({
    title: app.isPackaged ? '青编' : '[DEV] 青编',
    icon: applicationIcon,
    width: 1200,
    minWidth: 800,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      nodeIntegrationInSubFrames: false,
      // Keep HTML fullscreen independent of the macOS Spaces animation. Electron
      // 28 can leave the renderer stuck while that native transition is pending.
      disableHtmlFullscreenWindowResize: process.platform === 'darwin',
    },
  });

  const windowId = window.webContents.id;
  if (!external) mainWindow = window;
  let completeWorkspaceOpen: (() => void) | undefined;
  const initialWorkspace = external
    ? undefined
    : new Promise<void>((resolve) => {
        completeWorkspaceOpen = resolve;
      });
  const record: WindowRecord = {
    window,
    external,
    handles: new Set(),
    fullscreenReady: () => Promise.resolve(),
    ready: false,
    initialWorkspace,
    completeWorkspaceOpen,
  };
  windows.set(windowId, record);
  if (external) window.setTitle(external.binding.displayName);
  if (!app.isPackaged) {
    window.on('page-title-updated', (event, title) => {
      event.preventDefault();
      window?.setTitle(`[DEV] ${title.replace(/^\[DEV\]\s*/, '')}`);
    });
  }

  const transition = createFullscreenTransition();
  let nativeFullscreen = window.isFullScreen();
  let ownsSimpleFullscreen = false;
  record.fullscreenReady = transition.ready;
  window.on('enter-html-full-screen', () => {
    if (
      process.platform === 'darwin' &&
      window &&
      !nativeFullscreen &&
      !window.isSimpleFullScreen()
    ) {
      transition.begin();
      ownsSimpleFullscreen = true;
      try {
        window.setSimpleFullScreen(true);
      } finally {
        transition.settle();
      }
    }
  });
  window.on('enter-full-screen', () => {
    nativeFullscreen = true;
    transition.settle();
  });
  window.on('leave-full-screen', () => {
    nativeFullscreen = false;
    transition.settle();
  });
  window.on('leave-html-full-screen', () => {
    if (ownsSimpleFullscreen) {
      ownsSimpleFullscreen = false;
      window?.setSimpleFullScreen(false);
    }
    transition.settle();
  });
  window.on('closed', transition.settle);

  if (process.env['VITE_DEV_SERVER_URL']) {
    window.loadURL(process.env['VITE_DEV_SERVER_URL']);
  } else {
    window.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  window.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url === window?.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    try {
      const url = new URL(event.url);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (process.env['VITE_DEV_SERVER_URL'] &&
          url.origin === new URL(process.env['VITE_DEV_SERVER_URL']).origin)
      )
        event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on(
    'will-redirect',
    (event, url, _inPlace, isMainFrame) => {
      if (isMainFrame) {
        event.preventDefault();
        return;
      }
      try {
        const target = new URL(url);
        if (
          target.protocol !== 'https:' ||
          target.username ||
          target.password ||
          (process.env['VITE_DEV_SERVER_URL'] &&
            target.origin ===
              new URL(process.env['VITE_DEV_SERVER_URL']).origin)
        )
          event.preventDefault();
      } catch {
        event.preventDefault();
      }
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_contents, _permission, _origin, details) => details.isMainFrame === true,
  );
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback, details) =>
      callback(details.isMainFrame === true),
  );
  const shutdown = createShutdownCoordinator(
    (requestId) =>
      window.webContents.send('workspace:flush-request', requestId),
    () => {
      window.close();
    },
    (message) => {
      const retryQuit = interactiveDev && quitting;
      quitting = false;
      if (window.isDestroyed()) return;
      void dialog
        .showMessageBox(window, {
          type: 'error',
          title: '工作区保存失败',
          message: '尚未保存的改动未能写入，窗口保持打开。',
          detail: message,
          buttons: ['重试保存并关闭', '继续编辑'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response !== 0 || window.isDestroyed()) return;
          if (retryQuit) app.quit();
          else window.close();
        });
    },
    // A Vite reload can replace the renderer before it acknowledges the save.
    interactiveDev ? 15_000 : undefined,
  );
  const ready = (event: Electron.IpcMainEvent, value: boolean) => {
    if (
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    ) {
      record.ready = value === true;
      shutdown.setReady(value === true);
    }
  };
  const flushed = (
    event: Electron.IpcMainEvent,
    result: { requestId?: number; ok?: boolean; message?: string },
  ) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !result ||
      typeof result.requestId !== 'number'
    )
      return;
    if (record.pendingQuit?.id === result.requestId) {
      record.pendingQuit.complete(result.ok === true, result.message);
      return;
    }
    shutdown.complete(
      result.requestId,
      result.ok === true,
      typeof result.message === 'string' ? result.message : undefined,
    );
  };
  ipcMain.on('workspace:flush-ready', ready);
  ipcMain.on('workspace:flush-result', flushed);
  window.webContents.on('render-process-gone', () => {
    record.ready = false;
    shutdown.setReady(false);
    record.pendingQuit?.complete(false, '编辑器进程已退出，无法确认保存');
  });
  window.on('close', (event) => {
    if (!allowQuit && shutdown.shouldPreventClose()) event.preventDefault();
  });
  window.on('closed', () => {
    record.completeWorkspaceOpen?.();
    ipcMain.removeListener('workspace:flush-ready', ready);
    ipcMain.removeListener('workspace:flush-result', flushed);
    record.pendingQuit?.complete(false, '窗口已关闭');
    workspaceSubscriptions
      .get(windowId)
      ?.forEach((unsubscribe) => unsubscribe());
    workspaceSubscriptions.delete(windowId);
    windows.delete(windowId);
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

app.whenReady().then(async () => {
  // BrowserWindow.icon does not change the macOS Dock icon.
  app.dock?.setIcon(applicationIcon);
  storagePath = await resolveStoragePath(
    path.join(app.getPath('userData'), STORAGE_FILE),
  );

  console.log('Storage path:', storagePath);

  installContentSecurityPolicy(process.env['VITE_DEV_SERVER_URL']);
  registerWorkspaceHostIpc();
  registerExternalFileIpc();
  filesReady = true;
  const initial = [
    ...pendingFiles,
    ...launchFiles(process.argv.slice(app.isPackaged ? 1 : 2), process.cwd()),
  ];
  pendingFiles.length = 0;
  if (initial.length) await openDesktopFiles(initial);
  else createWindow();
  void promptDefaultApplications();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

handleTrusted('storage:get', async (_, key: string) => {
  return getStorageValue(storagePath, key);
});

handleTrusted('storage:set', async (_, key: string, value: unknown) => {
  await enqueueStorageWrite(() => setStorageValue(storagePath, key, value));
  return true;
});

handleTrusted('storage:remove', async (_, key: string) => {
  await enqueueStorageWrite(() => removeStorageValue(storagePath, key));
  return true;
});

handleTrusted('storage:clear', async () => {
  await enqueueStorageWrite(() => clearStorage(storagePath));
  return true;
});

handleTrusted('storage:keys', async () => listStorageKeys(storagePath));

handleTrusted('storage:reset', async (_, record: Record<string, unknown>) => {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('Invalid workspace reset');
  await enqueueStorageWrite(() =>
    archiveAndReplaceStorage(storagePath, record),
  );
  return true;
});

handleTrusted('window:fullscreen-ready', (event) =>
  windows.get(event.sender.id)!.fullscreenReady(),
);
