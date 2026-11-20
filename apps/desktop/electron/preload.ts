import { contextBridge, ipcRenderer } from 'electron';

// Keep activations until a live workspace view subscribes, including React remounts.
const workspaceFileListeners = new Set<(path: string) => void>();
const workspaceFilePaths: string[] = [];
const deliverWorkspaceFiles = () => {
  if (!workspaceFileListeners.size) return;
  for (const path of workspaceFilePaths.splice(0))
    workspaceFileListeners.forEach((listener) => listener(path));
};
const receiveWorkspaceFiles = () => {
  void ipcRenderer.invoke('files:workspace-pending').then((paths: string[]) => {
    workspaceFilePaths.push(...paths);
    deliverWorkspaceFiles();
  });
};
if (process.isMainFrame)
  ipcRenderer.on('files:workspace-file', receiveWorkspaceFiles);

if (process.isMainFrame)
  contextBridge.exposeInMainWorld('electronAPI', {
    readBundledPdfAsset: (kind: string, name: string) =>
      ipcRenderer.invoke('pdf:asset', kind, name),
    openExternal: (url: string) => ipcRenderer.invoke('link:external', url),
    whenFullscreenReady: () => ipcRenderer.invoke('window:fullscreen-ready'),
    onShutdown: (flush: () => Promise<void>, onCancelled?: () => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        requestId: number,
      ) => {
        void Promise.resolve()
          .then(flush)
          .then(
            () =>
              ipcRenderer.send('workspace:flush-result', {
                requestId,
                ok: true,
              }),
            (error) =>
              ipcRenderer.send('workspace:flush-result', {
                requestId,
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              }),
          );
      };
      ipcRenderer.on('workspace:flush-request', listener);
      const resume = () => {
        onCancelled?.();
      };
      ipcRenderer.on('files:resume', resume);
      ipcRenderer.send('workspace:flush-ready', true);
      return () => {
        ipcRenderer.removeListener('workspace:flush-request', listener);
        ipcRenderer.removeListener('files:resume', resume);
        ipcRenderer.send('workspace:flush-ready', false);
      };
    },
    files: {
      binding: () => ipcRenderer.invoke('files:binding'),
      warnings: () => ipcRenderer.invoke('files:warnings'),
      readImage: (href: string) => ipcRenderer.invoke('files:image', href),
      openLink: (href: string) => ipcRenderer.invoke('files:link', href),
      setDefaults: () => ipcRenderer.invoke('files:defaults'),
      resolve: (action: string, files: unknown) =>
        ipcRenderer.invoke('files:resolve', action, files),
      onOpenWorkspaceFile: (listener: (path: string) => void) => {
        workspaceFileListeners.add(listener);
        deliverWorkspaceFiles();
        receiveWorkspaceFiles();
        return () => {
          workspaceFileListeners.delete(listener);
        };
      },
      host: {
        readSnapshot: (h: unknown) =>
          ipcRenderer.invoke('file-host:snapshot', h),
        readFile: (h: unknown, path: string) =>
          ipcRenderer.invoke('file-host:read-file', h, path),
        readResource: (h: unknown, key: string) =>
          ipcRenderer.invoke('file-host:read-resource', h, key),
        commit: (h: unknown, request: unknown) =>
          ipcRenderer.invoke('file-host:commit', h, request),
        resolveConflict: (h: unknown, request: unknown) =>
          ipcRenderer.invoke('file-host:resolve-conflict', h, request),
        closeWorkspace: (h: unknown) =>
          ipcRenderer.invoke('file-host:close', h),
        subscribe: (h: unknown, listener: (hint: unknown) => void) => {
          const id = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const channel = `file-host:change:${id}`;
          const wrapped = (_event: Electron.IpcRendererEvent, hint: unknown) =>
            listener(hint);
          ipcRenderer.on(channel, wrapped);
          ipcRenderer.send('file-host:subscribe', h, id);
          return () => {
            ipcRenderer.removeListener(channel, wrapped);
            ipcRenderer.send('file-host:unsubscribe', id);
          };
        },
      },
    },
    storage: {
      keys: () => ipcRenderer.invoke('storage:keys'),
      get: (key: string) => ipcRenderer.invoke('storage:get', key),
      set: (key: string, value: unknown) =>
        ipcRenderer.invoke('storage:set', key, value),
      remove: (key: string) => ipcRenderer.invoke('storage:remove', key),
      clear: () => ipcRenderer.invoke('storage:clear'),
      reset: (record: Record<string, unknown>) =>
        ipcRenderer.invoke('storage:reset', record),
    },
    workspaceHost: {
      readWorkspaceLocation: (h: unknown) =>
        ipcRenderer.invoke('workspace-host:location', h),
      revealWorkspaceLocation: (h: unknown) =>
        ipcRenderer.invoke('workspace-host:reveal-location', h),
      readBuiltinUpdate: (h: unknown) =>
        ipcRenderer.invoke('workspace-host:builtin-info', h),
      updateBuiltinWorkspace: (
        h: unknown,
        id: string,
        options?: { backup: boolean },
      ) => ipcRenderer.invoke('workspace-host:builtin-update', h, id, options),
      revealBuiltinBackups: (h: unknown) =>
        ipcRenderer.invoke('workspace-host:builtin-backups', h),
      readGlobalConfig: () =>
        ipcRenderer.invoke('workspace-host:read-global-config'),
      writeGlobalConfig: (
        value: Record<string, unknown>,
        expectedVersion: number,
      ) =>
        ipcRenderer.invoke(
          'workspace-host:write-global-config',
          value,
          expectedVersion,
        ),
      openWorkspace: (request: unknown) =>
        ipcRenderer.invoke('workspace-host:open', request),
      activateWorkspace: (handle: unknown) =>
        ipcRenderer.invoke('workspace-host:activate', handle),
      createWorkspace: (request: { name: string }) =>
        ipcRenderer.invoke('workspace-host:create', request),
      updateWorkspaceHistory: (request: {
        id: string;
        pinned?: boolean;
        remove?: boolean;
      }) => ipcRenderer.invoke('workspace-host:update-history', request),
      listWorkspaceHistory: () => ipcRenderer.invoke('workspace-host:history'),
      readSnapshot: (handle: unknown) =>
        ipcRenderer.invoke('workspace-host:snapshot', handle),
      initializeAgent: (handle: unknown) =>
        ipcRenderer.invoke('workspace-host:initialize-agent', handle),
      readFile: (handle: unknown, path: string) =>
        ipcRenderer.invoke('workspace-host:read-file', handle, path),
      readResource: (handle: unknown, key: string) =>
        ipcRenderer.invoke('workspace-host:read-resource', handle, key),
      openResourceExternal: (handle: unknown, path: string) =>
        ipcRenderer.invoke('workspace-host:open-resource', handle, path),
      commit: (handle: unknown, request: unknown) =>
        ipcRenderer.invoke('workspace-host:commit', handle, request),
      versions: (handle: unknown, request: unknown) =>
        ipcRenderer.invoke('workspace-host:versions', handle, request),
      git: (handle: unknown, request: unknown) =>
        ipcRenderer.invoke('workspace-host:git', handle, request),
      resolveConflict: (handle: unknown, request: unknown) =>
        ipcRenderer.invoke('workspace-host:resolve-conflict', handle, request),
      closeWorkspace: (handle: unknown) =>
        ipcRenderer.invoke('workspace-host:close', handle),
      subscribe: (
        handle: { key: string },
        listener: (hint: unknown) => void,
      ) => {
        const subId = `sub-${Math.random().toString(36).slice(2)}-${Date.now()}`;
        const channel = `workspace-host:change:${subId}`;
        const wrapped = (_event: Electron.IpcRendererEvent, hint: unknown) =>
          listener(hint);
        ipcRenderer.on(channel, wrapped);
        ipcRenderer.send('workspace-host:subscribe', handle, subId);
        return () => {
          ipcRenderer.send('workspace-host:unsubscribe', handle, subId);
          ipcRenderer.removeListener(channel, wrapped);
        };
      },
    },
  });
