import { VersionError, type VersionResult } from '@sue/verd-board-workspace';
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
  WorkspaceHistoryEntry,
} from '@sue/verd-board-workspace';

interface DesktopBridge {
  initializeAgent?: WorkspaceHost['initializeAgent'];
  git: NonNullable<WorkspaceHost['git']>;
  versions(
    handle: WorkspaceHandle,
    request: Parameters<NonNullable<WorkspaceHost['versions']>>[1],
  ): Promise<
    | VersionResult
    | { versionError: { code: VersionError['code']; diagnostic: string } }
  >;
  readWorkspaceLocation: NonNullable<WorkspaceHost['readWorkspaceLocation']>;
  revealWorkspaceLocation: NonNullable<
    WorkspaceHost['revealWorkspaceLocation']
  >;
  pickWorkspaceParent: NonNullable<WorkspaceHost['pickWorkspaceParent']>;
  createWorkspace: NonNullable<WorkspaceHost['createWorkspace']>;
  updateWorkspaceHistory: NonNullable<WorkspaceHost['updateWorkspaceHistory']>;
  readBuiltinUpdate: NonNullable<WorkspaceHost['readBuiltinUpdate']>;
  updateBuiltinWorkspace: NonNullable<WorkspaceHost['updateBuiltinWorkspace']>;
  revealBuiltinBackups: NonNullable<WorkspaceHost['revealBuiltinBackups']>;
  readGlobalConfig(): Promise<GlobalConfigSnapshot>;
  writeGlobalConfig(
    value: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<{ applied: boolean; snapshot: GlobalConfigSnapshot }>;
  openWorkspace(
    request?: OpenWorkspaceRequest,
  ): Promise<WorkspaceHandle | null>;
  activateWorkspace(handle: WorkspaceHandle): Promise<void>;
  listWorkspaceHistory(): Promise<WorkspaceHistoryEntry[]>;
  readSnapshot(handle: WorkspaceHandle): Promise<WorkspaceHostSnapshot>;
  readFile(handle: WorkspaceHandle, path: string): Promise<RawFileRead>;
  readResource: WorkspaceHost['readResource'];
  openResourceExternal: NonNullable<WorkspaceHost['openResourceExternal']>;
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
  onShutdown?: (
    flush: () => Promise<void>,
    onCancelled?: () => void,
  ) => () => void;
}

const electronApi = (): DesktopElectronApi | undefined =>
  (globalThis as { electronAPI?: DesktopElectronApi }).electronAPI;

/**
 * Renderer-side WorkspaceHost for the desktop app. Every call is a thin IPC
 * hop into the main process' fs-backed host; filesystem mutations resolve opaque workspace handle keys in the main process.
 * Absolute paths are exposed for directory selection and storage location display.
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
    storageKind: 'filesystem',
    capabilities: {
      pickWorkspace: true,
      openBuiltinWorkspace: true,
      openPatternWorkspace: true,
    },
    readWorkspaceLocation: (h) => bridge().readWorkspaceLocation(h),
    revealWorkspaceLocation: (h) => bridge().revealWorkspaceLocation(h),
    readBuiltinUpdate: (h) => bridge().readBuiltinUpdate(h),
    updateBuiltinWorkspace: (h, id, options) =>
      bridge().updateBuiltinWorkspace(h, id, options),
    revealBuiltinBackups: (h) => bridge().revealBuiltinBackups(h),
    pickWorkspaceParent: () => bridge().pickWorkspaceParent(),
    createWorkspace: (request) => bridge().createWorkspace(request),
    updateWorkspaceHistory: (request) =>
      bridge().updateWorkspaceHistory(request),
    readGlobalConfig: () => bridge().readGlobalConfig(),
    writeGlobalConfig: (value, expectedVersion) =>
      bridge().writeGlobalConfig(value, expectedVersion),
    openWorkspace: (request) => bridge().openWorkspace(request),
    activateWorkspace: (handle) => bridge().activateWorkspace(handle),
    listWorkspaceHistory: () => bridge().listWorkspaceHistory(),
    readSnapshot: (handle) => bridge().readSnapshot(handle),
    initializeAgent: (handle) => {
      const initialize = bridge().initializeAgent;
      if (!initialize) throw new Error('Agent setup is unavailable');
      return initialize(handle);
    },
    readFile: (handle, path) => bridge().readFile(handle, path),
    readResource: (handle, key) => bridge().readResource(handle, key),
    openResourceExternal: (handle, path) =>
      bridge().openResourceExternal(handle, path),
    commit: (handle, request) => bridge().commit(handle, request),
    versionProvider: { id: 'git' },
    versions: async (handle, request) => {
      const value = await bridge().versions(handle, request);
      if ('versionError' in value)
        throw new VersionError(
          value.versionError.code,
          value.versionError.diagnostic,
        );
      return value;
    },
    git: (handle, request) => bridge().git(handle, request),
    subscribe: (handle, listener) => bridge().subscribe(handle, listener),
    resolveConflict: (handle, request) =>
      bridge().resolveConflict(handle, request),
    closeWorkspace: (handle) => bridge().closeWorkspace(handle),
    onShutdown: (flush, onCancelled) =>
      electronApi()?.onShutdown?.(flush, onCancelled) ?? (() => {}),
  };
};
