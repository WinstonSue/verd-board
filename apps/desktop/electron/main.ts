import { readFileSync } from 'node:fs';
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
if (interactiveDev) {
  if (!app.requestSingleInstanceLock()) {
    console.error('[VerdBoard Dev] 该开发数据目录已有实例，请先退出原实例。');
    process.exit(0);
  }

  // A stopped or crashed Vite owner closes the inherited IPC channel.
  // Use the regular quit path so the renderer can flush pending edits.
  if (process.connected) process.once('disconnect', () => app.quit());
}
const applicationIcon = path.join(
  __dirname,
  app.isPackaged ? '../build/icon.png' : '../build/icon-dev.png',
);

let mainWindow: BrowserWindow | null = null;
let fullscreenReady = (): Promise<void> => Promise.resolve();
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
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
            : '../../../packages/product/agent-patterns/workspace',
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
  return (
    !!mainWindow &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}
const handleTrusted: typeof ipcMain.handle = (channel, listener) =>
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedSender(event)) throw new Error('Untrusted IPC frame');
    return listener(event, ...args);
  });

const workspaceSubscriptions = new Map<number, Map<string, () => void>>();

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
                  '../../../packages/product/agent-patterns/workspace',
                ),
          },
        ).then((result) =>
          workspaceManager.open({ path: result.path, name: 'Agent 范式库' }),
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
  handleTrusted('workspace-host:read-file', (_, handle, path: string) =>
    workspaceHost.readFile(handle, path),
  );
  handleTrusted('workspace-host:commit', (_, handle, request) =>
    workspaceHost.commit(handle, request),
  );
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

function createWindow() {
  mainWindow = new BrowserWindow({
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

  if (!app.isPackaged) {
    mainWindow.on('page-title-updated', (event, title) => {
      event.preventDefault();
      mainWindow?.setTitle(`[DEV] ${title.replace(/^\[DEV\]\s*/, '')}`);
    });
  }

  const transition = createFullscreenTransition();
  let nativeFullscreen = mainWindow.isFullScreen();
  let ownsSimpleFullscreen = false;
  fullscreenReady = transition.ready;
  mainWindow.on('enter-html-full-screen', () => {
    const window = mainWindow;
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
  mainWindow.on('enter-full-screen', () => {
    nativeFullscreen = true;
    transition.settle();
  });
  mainWindow.on('leave-full-screen', () => {
    nativeFullscreen = false;
    transition.settle();
  });
  mainWindow.on('leave-html-full-screen', () => {
    if (ownsSimpleFullscreen) {
      ownsSimpleFullscreen = false;
      mainWindow?.setSimpleFullScreen(false);
    }
    transition.settle();
  });
  mainWindow.on('closed', transition.settle);

  if (process.env['VITE_DEV_SERVER_URL']) {
    mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow?.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  mainWindow.webContents.on('will-frame-navigate', (event) => {
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
  mainWindow.webContents.on(
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
  const window = mainWindow;
  const shutdown = createShutdownCoordinator(
    (requestId) =>
      window.webContents.send('workspace:flush-request', requestId),
    () => {
      if (quitting) app.quit();
      else window.close();
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
    if (event.sender === window.webContents) shutdown.setReady(value === true);
  };
  const flushed = (
    event: Electron.IpcMainEvent,
    result: { requestId?: number; ok?: boolean; message?: string },
  ) => {
    if (
      event.sender !== window.webContents ||
      !result ||
      typeof result.requestId !== 'number'
    )
      return;
    shutdown.complete(
      result.requestId,
      result.ok === true,
      typeof result.message === 'string' ? result.message : undefined,
    );
  };
  ipcMain.on('workspace:flush-ready', ready);
  ipcMain.on('workspace:flush-result', flushed);
  window.webContents.on('render-process-gone', () => shutdown.setReady(false));
  window.on('close', (event) => {
    if (shutdown.shouldPreventClose()) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    ipcMain.removeListener('workspace:flush-ready', ready);
    ipcMain.removeListener('workspace:flush-result', flushed);
    mainWindow = null;
  });
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
  createWindow();

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

handleTrusted('window:fullscreen-ready', (event) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents
  )
    throw new Error('Unknown fullscreen window');
  return fullscreenReady();
});
