import { createShutdownCoordinator } from './shutdown';
import { createFullscreenTransition } from './fullscreen-transition';
import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
import * as path from 'path';
import {
  contentSecurityPolicy,
  shouldAttachContentSecurityPolicy,
} from './content-security-policy';
import { resolveStoragePath, STORAGE_FILE } from './migrate-storage';
import {
  archiveAndReplaceStorage,
  clearStorage,
  createSerialQueue,
  getStorageValue,
  listStorageKeys,
  removeStorageValue,
  setStorageValue,
} from './storage-file';
import { createFsWorkspaceHost } from './workspace-host-fs';
import { createDesktopWorkspaceManager } from './workspace-startup';

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
const development = !!process.env['VITE_DEV_SERVER_URL'];
const defaultWorkspaceRoot = () =>
  development
    ? path.resolve(__dirname, '../../../workspace')
    : path.join(app.getPath('userData'), 'workspaces', 'default');
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
const workspaceHost = createFsWorkspaceHost({
  defaultRoot: defaultWorkspaceRoot,
  globalConfigPath: () =>
    path.join(app.getPath('userData'), 'verdboard-global-config.json'),
  pickDirectory: pickWorkspaceDirectory,
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
  development,
  explicitRoot: process.env['VERDBOARD_WORKSPACE_PATH'],
  pickDirectory: pickWorkspaceDirectory,
});

const workspaceSubscriptions = new Map<number, Map<string, () => void>>();

function registerWorkspaceHostIpc() {
  ipcMain.handle('workspace-host:read-global-config', () =>
    workspaceHost.readGlobalConfig(),
  );
  ipcMain.handle(
    'workspace-host:write-global-config',
    (_, value: Record<string, unknown>, expectedVersion: number) =>
      workspaceHost.writeGlobalConfig(value, expectedVersion),
  );
  ipcMain.handle('workspace-host:open', (_, request) =>
    workspaceManager.open(request),
  );
  ipcMain.handle('workspace-host:activate', (_, handle) =>
    workspaceManager.activate(handle),
  );
  ipcMain.handle('workspace-host:snapshot', (_, handle) =>
    workspaceHost.readSnapshot(handle),
  );
  ipcMain.handle('workspace-host:read-file', (_, handle, path: string) =>
    workspaceHost.readFile(handle, path),
  );
  ipcMain.handle('workspace-host:commit', (_, handle, request) =>
    workspaceHost.commit(handle, request),
  );
  ipcMain.handle('workspace-host:resolve-conflict', (_, handle, request) =>
    workspaceHost.resolveConflict(handle, request),
  );
  ipcMain.handle('workspace-host:close', (_, handle) =>
    workspaceHost.closeWorkspace(handle),
  );
  ipcMain.on(
    'workspace-host:subscribe',
    (event, handle: { key: string }, subId: string) => {
      if (typeof subId !== 'string' || !handle?.key) return;
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
    width: 1200,
    minWidth: 800,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const transition = createFullscreenTransition();
  let nativeFullscreen = mainWindow.isFullScreen();
  fullscreenReady = transition.ready;
  mainWindow.on('enter-html-full-screen', () => {
    if (process.platform === 'darwin' && !nativeFullscreen) transition.begin();
  });
  mainWindow.on('enter-full-screen', () => {
    nativeFullscreen = true;
    transition.settle();
  });
  mainWindow.on('leave-full-screen', () => {
    nativeFullscreen = false;
    transition.settle();
  });
  mainWindow.on('closed', transition.settle);

  if (process.env['VITE_DEV_SERVER_URL']) {
    mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL']);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow?.webContents.getURL()) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });
  const window = mainWindow;
  const shutdown = createShutdownCoordinator(
    (requestId) =>
      window.webContents.send('workspace:flush-request', requestId),
    () => {
      if (quitting) app.quit();
      else window.close();
    },
    (message) => {
      quitting = false;
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
          if (result.response === 0 && !window.isDestroyed()) window.close();
        });
    },
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
  if (process.env['VITE_DEV_SERVER_URL']) {
    storagePath = await resolveStoragePath(
      path.join(__dirname, '..', STORAGE_FILE),
    );
  } else {
    storagePath = await resolveStoragePath(
      path.join(app.getPath('userData'), STORAGE_FILE),
    );
  }

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

ipcMain.handle('storage:get', async (_, key: string) => {
  return getStorageValue(storagePath, key);
});

ipcMain.handle('storage:set', async (_, key: string, value: unknown) => {
  await enqueueStorageWrite(() => setStorageValue(storagePath, key, value));
  return true;
});

ipcMain.handle('storage:remove', async (_, key: string) => {
  await enqueueStorageWrite(() => removeStorageValue(storagePath, key));
  return true;
});

ipcMain.handle('storage:clear', async () => {
  await enqueueStorageWrite(() => clearStorage(storagePath));
  return true;
});

ipcMain.handle('storage:keys', async () => listStorageKeys(storagePath));

ipcMain.handle('storage:reset', async (_, record: Record<string, unknown>) => {
  if (!record || typeof record !== 'object' || Array.isArray(record))
    throw new Error('Invalid workspace reset');
  await enqueueStorageWrite(() =>
    archiveAndReplaceStorage(storagePath, record),
  );
  return true;
});

ipcMain.handle('window:fullscreen-ready', (event) => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents
  )
    throw new Error('Unknown fullscreen window');
  return fullscreenReady();
});
