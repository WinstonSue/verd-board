import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  whenFullscreenReady: () => ipcRenderer.invoke('window:fullscreen-ready'),
  onShutdown: (flush: () => Promise<void>) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: number) => {
      void Promise.resolve()
        .then(flush)
        .then(
          () =>
            ipcRenderer.send('workspace:flush-result', { requestId, ok: true }),
          (error) =>
            ipcRenderer.send('workspace:flush-result', {
              requestId,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            }),
        );
    };
    ipcRenderer.on('workspace:flush-request', listener);
    ipcRenderer.send('workspace:flush-ready', true);
    return () => {
      ipcRenderer.removeListener('workspace:flush-request', listener);
      ipcRenderer.send('workspace:flush-ready', false);
    };
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
    readSnapshot: (handle: unknown) =>
      ipcRenderer.invoke('workspace-host:snapshot', handle),
    readFile: (handle: unknown, path: string) =>
      ipcRenderer.invoke('workspace-host:read-file', handle, path),
    commit: (handle: unknown, request: unknown) =>
      ipcRenderer.invoke('workspace-host:commit', handle, request),
    resolveConflict: (handle: unknown, request: unknown) =>
      ipcRenderer.invoke('workspace-host:resolve-conflict', handle, request),
    closeWorkspace: (handle: unknown) =>
      ipcRenderer.invoke('workspace-host:close', handle),
    subscribe: (handle: { key: string }, listener: (hint: unknown) => void) => {
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
