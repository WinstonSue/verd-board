import type {
  ChangeHint,
  CommitReceipt,
  CommitRequest,
  ConflictResolution,
  GlobalConfigSnapshot,
  OpenWorkspaceRequest,
  RawFileRead,
  WorkspaceHandle,
  WorkspaceHost,
  WorkspaceHostSnapshot,
} from './workspace-host';

interface DesktopBridge {
  readGlobalConfig(): Promise<GlobalConfigSnapshot>;
  writeGlobalConfig(
    value: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<{ applied: boolean; snapshot: GlobalConfigSnapshot }>;
  openWorkspace(request: OpenWorkspaceRequest): Promise<WorkspaceHandle | null>;
  readSnapshot(handle: WorkspaceHandle): Promise<WorkspaceHostSnapshot>;
  readFile(handle: WorkspaceHandle, path: string): Promise<RawFileRead>;
  commit(
    handle: WorkspaceHandle,
    request: CommitRequest,
  ): Promise<CommitReceipt>;
  resolveConflict(
    handle: WorkspaceHandle,
    request: ConflictResolution,
  ): Promise<CommitReceipt>;
  closeWorkspace(handle: WorkspaceHandle): Promise<void>;
  subscribe(
    handle: WorkspaceHandle,
    listener: (hint: ChangeHint) => void,
  ): () => void;
}

interface DesktopElectronApi {
  workspaceHost?: DesktopBridge;
  onShutdown?: (flush: () => Promise<void>) => () => void;
}

const electronApi = (): DesktopElectronApi | undefined =>
  (globalThis as { electronAPI?: DesktopElectronApi }).electronAPI;

/**
 * Renderer-side WorkspaceHost for the desktop app. Every call is a thin IPC
 * hop into the main process' fs-backed host; the renderer never sees real
 * filesystem paths, only opaque workspace handle keys.
 */
export const createDesktopWorkspaceHost = (): WorkspaceHost => {
  const bridge = () => {
    const api = electronApi()?.workspaceHost;
    if (!api)
      throw new Error(
        'Desktop workspace bridge is unavailable (not running in Electron)',
      );
    return api;
  };
  return {
    readGlobalConfig: () => bridge().readGlobalConfig(),
    writeGlobalConfig: (value, expectedVersion) =>
      bridge().writeGlobalConfig(value, expectedVersion),
    openWorkspace: (request) =>
      bridge().openWorkspace(request ?? { default: true }),
    readSnapshot: (handle) => bridge().readSnapshot(handle),
    readFile: (handle, path) => bridge().readFile(handle, path),
    commit: (handle, request) => bridge().commit(handle, request),
    subscribe: (handle, listener) => bridge().subscribe(handle, listener),
    resolveConflict: (handle, request) =>
      bridge().resolveConflict(handle, request),
    closeWorkspace: (handle) => bridge().closeWorkspace(handle),
    onShutdown: (flush) => electronApi()?.onShutdown?.(flush) ?? (() => {}),
  };
};
