import type { CellId } from '@sue/board-core';
import type { DocumentFileV1 } from '../documents/document-files';
import type { FrameFileV2 } from '../frames/frame-files';

/** Content digest; never derived from timestamps. */
export type FileVersion = string;

/** Opaque workspace identity inside one host: a directory or a virtual store. */
export type WorkspaceKey = string;

export interface WorkspaceHandle {
  /** Host-private key; renderers never resolve it to a real location. */
  key: WorkspaceKey;
  name: string;
  /** Desktop's editable built-in default; absent on other hosts. */
  isDefault?: boolean;
  /** Durable history identity, independent of the process-local handle key. */
  historyId?: string;
}

export interface WorkspaceHistoryEntry {
  id: string;
  name: string;
  /** Host-generated parent-folder hint for otherwise identical names. */
  description?: string;
  lastOpenedAt: number;
  pinned?: boolean;
  availability?: 'available' | 'missing' | 'unavailable';
}

export interface GlobalConfigSnapshot {
  /** Revision for compare-and-swap writes. */
  version: number;
  value: Record<string, unknown>;
}

export interface WorkspaceConfigSnapshot {
  version: number;
  value: Record<string, unknown>;
}

/** Portable project facts; identity and name remain in config.value. */
export interface WorkspaceProjectInfo {
  description: string;
  /** Ordered stable file IDs; the first available entry opens without a saved session. */
  entryDocumentIds: string[];
}

export interface WorkspaceTabRef {
  /** Stable file identity — canvas root frame id or document id. */
  fileId: CellId;
}

export interface WorkspaceTabGroupState {
  id: string;
  /** Empty for the localized default group name. */
  name: string;
  tabs: WorkspaceTabRef[];
  activeTabId: CellId | null;
}

export interface WorkspaceSessionState {
  activeView?: 'home' | 'all' | 'search' | 'library' | 'file';
  /** Current group projection, retained for hosts predating tab groups. */
  tabs: WorkspaceTabRef[];
  activeTabId: CellId | null;
  expandedDirs: string[];
  /** Personal, per-view fold state. Kept out of document content and history. */
  documentFolds?: Record<string, Record<string, boolean>>;
  groups?: WorkspaceTabGroupState[];
  activeGroupId?: string;
}

/**
 * Session-state reader: current writes use `{fileId}` tabs while older
 * payloads stored `{frameId}`; both describe the same stable file identity.
 */
export const normalizeWorkspaceSessionState = (
  raw: unknown,
): WorkspaceSessionState | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<WorkspaceSessionState> & {
    tabs?: { fileId?: unknown; frameId?: unknown }[];
  };
  if (!Array.isArray(candidate.tabs)) return null;
  const readTabs = (rawTabs: unknown): WorkspaceTabRef[] | null => {
    if (!Array.isArray(rawTabs)) return null;
    const tabs: WorkspaceTabRef[] = [];
    for (const tab of rawTabs) {
      const fileId =
        typeof tab?.fileId === 'string'
          ? tab.fileId
          : typeof tab?.frameId === 'string'
            ? tab.frameId
            : null;
      if (fileId === null) return null;
      if (!tabs.some((item) => item.fileId === fileId)) tabs.push({ fileId });
    }
    return tabs;
  };
  const tabs = readTabs(candidate.tabs);
  if (!tabs) return null;
  const state: WorkspaceSessionState = {
    activeView: ['home', 'all', 'search', 'library', 'file'].includes(
      String(candidate.activeView),
    )
      ? candidate.activeView
      : undefined,
    tabs,
    activeTabId:
      typeof candidate.activeTabId === 'string' ? candidate.activeTabId : null,
    expandedDirs: Array.isArray(candidate.expandedDirs)
      ? candidate.expandedDirs.filter(
          (dir): dir is string => typeof dir === 'string',
        )
      : [],
  };
  const folds = candidate.documentFolds;
  if (folds && typeof folds === 'object' && !Array.isArray(folds)) {
    state.documentFolds = Object.fromEntries(
      Object.entries(folds).flatMap(([key, value]) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? [
              [
                key,
                Object.fromEntries(
                  Object.entries(value).filter(
                    ([, flag]) => typeof flag === 'boolean',
                  ),
                ),
              ],
            ]
          : [],
      ),
    );
  }
  if (Array.isArray(candidate.groups)) {
    const groups: WorkspaceTabGroupState[] = [];
    for (const group of candidate.groups) {
      if (
        !group ||
        typeof group.id !== 'string' ||
        !group.id ||
        typeof group.name !== 'string' ||
        groups.some((item) => item.id === group.id)
      )
        continue;
      const groupTabs = readTabs(group.tabs);
      if (!groupTabs) continue;
      groups.push({
        id: group.id,
        name: group.name.trim(),
        tabs: groupTabs,
        activeTabId: groupTabs.some((tab) => tab.fileId === group.activeTabId)
          ? group.activeTabId
          : (groupTabs[0]?.fileId ?? null),
      });
    }
    if (groups.length) {
      const active =
        groups.find((group) => group.id === candidate.activeGroupId) ??
        groups[0];
      state.groups = groups;
      state.activeGroupId = active.id;
      state.tabs = active.tabs;
      state.activeTabId = active.activeTabId;
    }
  }
  return state;
};

export interface WorkspaceEntryMeta {
  /** Workspace-relative POSIX path. */
  path: string;
  kind: 'file' | 'directory';
  /** Stable identity from directory metadata, when one has been assigned. */
  folderId?: string;
  /** `*.verd.json` payload files. */
  canvas: boolean;
  /** `*.verd-doc.json` payload files; absent means "detect by suffix". */
  document?: boolean;
  version?: FileVersion;
  size?: number;
}

/** Project resources have logical keys, never content-tree paths. */
export interface WorkspaceResourceMeta {
  key: string;
  version: FileVersion;
  size: number;
}

export interface WorkspaceCanvasPayload {
  path: string;
  version: FileVersion;
  /** Parsed file, or null when the bytes fail to load. */
  file: FrameFileV2 | null;
  diagnostic?: string;
}

export interface WorkspaceDocumentPayload {
  path: string;
  version: FileVersion;
  /** Parsed file, or null when the bytes fail to load. */
  file: DocumentFileV1 | null;
  diagnostic?: string;
}

export interface WorkspaceTrashMeta {
  entryId: string;
  originalPath: string;
  trashedAt: number;
}

export interface WorkspaceHostSnapshot {
  agent?: {
    ready: boolean;
    resourceId: string | null;
    diagnostics: { code: string; message: string; path?: string }[];
  };
  config: WorkspaceConfigSnapshot;
  session: WorkspaceSessionState | null;
  entries: WorkspaceEntryMeta[];
  resources?: WorkspaceResourceMeta[];
  canvases: WorkspaceCanvasPayload[];
  /**
   * Parsed `*.verd-doc.json` payloads. Hosts that predate documents may
   * omit this; loaders then read matching entries through `readFile`.
   */
  documents?: WorkspaceDocumentPayload[];
  /** Trashed subtrees restorable by entryId. */
  trash: WorkspaceTrashMeta[];
  diagnostics: { path?: string; message: string }[];
}

export interface RawFileRead {
  path: string;
  version: FileVersion;
  content: Uint8Array;
}

export interface FileWriteOp {
  path: string;
  content: Uint8Array | string;
  /**
   * Required current digest. `null` asserts the file does not exist yet;
   * a version asserts the current digest equals it. Every write is
   * conditional — there is no unconditional overwrite.
   */
  expectedVersion: FileVersion | null;
}

export interface FileMoveOp {
  from: string;
  to: string;
  /**
   * Required digest of `from`; `to` must not exist. Directories carry no
   * version — omit it when moving a directory.
   */
  expectedVersion?: FileVersion;
}

export interface TrashOp {
  path: string;
  /**
   * Required digest for files. Directories carry no version — omit it when
   * trashing a directory.
   */
  expectedVersion?: FileVersion;
}

export interface RestoreOp {
  entryId: string;
  /** Defaults to the recorded original path; must be unoccupied. */
  toPath?: string;
}

export interface WorkspaceConfigWrite {
  value: Record<string, unknown>;
  expectedVersion: number;
}

export interface CommitRequest {
  /** Optional native path/content manifest precondition, supported by the Node host. */
  expectedWorkspaceVersion?: string;
  expectedAgentResourceId?: string | null;
  /** Stable id; retries with the same id return the original receipt. */
  transactionId: string;
  writes?: FileWriteOp[];
  /** Paths are resource keys (assets/... or history/...), not workspace paths. */
  resourceWrites?: FileWriteOp[];
  moves?: FileMoveOp[];
  mkdirs?: string[];
  /** Move files or directories into the trash area. */
  trash?: TrashOp[];
  /** Restore a trashed entry to its original or a given path. */
  restore?: RestoreOp[];
  /** Permanently remove only these trash entries; missing entries are no-ops. */
  purge?: string[];
  config?: WorkspaceConfigWrite;
  /** Navigation state; last-write-wins and never a document timestamp. */
  session?: WorkspaceSessionState;
}

export type CommitRejection =
  | 'version-conflict'
  | 'target-exists'
  | 'source-missing'
  | 'invalid'
  | 'io-error';

export interface CommitReceipt {
  transactionId: string;
  outcome: 'applied' | 'rejected';
  reason?: CommitRejection;
  path?: string;
  expected?: FileVersion | null;
  actual?: FileVersion | null;
  /** Post-commit digests for every written or moved-to path. */
  versions?: Record<string, FileVersion>;
  resourceVersions?: Record<string, FileVersion>;
  trashEntries?: { path: string; entryId: string }[];
}

export interface OpenWorkspaceRequest {
  /** Open the installed agent pattern library's editable user copy (Desktop). */
  patterns?: boolean;
  /** Reopen a recorded workspace without creating a missing directory. */
  historyId?: string;
  /** Open an existing or create a missing workspace at this location. */
  path?: string;
  /** Host-defined default location (fresh install / first run). */
  default?: boolean;
  /** Ask the user to choose a location; cancelling resolves `null`. */
  pick?: boolean;
  /** Display name for a workspace being created. */
  name?: string;
  /** Create the workspace when it does not exist. Defaults to true. */
  create?: boolean;
}

export interface ConflictResolution {
  path: string;
  action: 'load-disk' | 'keep-local' | 'save-copy';
  /** Local bytes for keep-local / save-copy. */
  content?: Uint8Array | string;
  /** Destination for save-copy. */
  toPath?: string;
  transactionId: string;
}

/** Change hint: the workspace may have changed; apps re-read to confirm. */
export interface ChangeHint {
  paths?: string[];
}

export interface BuiltinWorkspaceUpdateInfo {
  kind: 'project' | 'agent-patterns';
  currentReleaseId: string | null;
  releaseId: string;
  currentVersion: string | null;
  version: string;
  hasBackups: boolean;
}
export interface WorkspaceHostCapabilities {
  pickWorkspace: boolean;
  openBuiltinWorkspace: boolean;
  openPatternWorkspace: boolean;
}

/** Absent declarations preserve the contract of existing third-party hosts. */
export const workspaceHostSupports = (
  host: Pick<WorkspaceHost, 'capabilities'>,
  capability: keyof WorkspaceHostCapabilities,
): boolean => host.capabilities?.[capability] !== false;

export const workspaceDisplayName = (
  value: unknown,
  fallback: string,
): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export interface WorkspaceHost {
  storageKind?: 'filesystem' | 'browser';
  versionProvider?: { id: string };
  versions?: import('./workspace-versions').WorkspaceVersionHost;
  /** Optional for third-party hosts; legacy snapshots remain readable. */
  git?: import('./workspace-git').WorkspaceGitHost;
  capabilities?: Readonly<WorkspaceHostCapabilities>;
  readWorkspaceLocation?(handle: WorkspaceHandle): Promise<string>;
  revealWorkspaceLocation?(handle: WorkspaceHandle): Promise<void>;
  readBuiltinUpdate?(
    handle: WorkspaceHandle,
  ): Promise<BuiltinWorkspaceUpdateInfo | null>;
  /** A cancelled backup folder picker returns null without replacing content. */
  updateBuiltinWorkspace?(
    handle: WorkspaceHandle,
    releaseId: string,
    options?: { backup: boolean },
  ): Promise<WorkspaceHandle | null>;
  revealBuiltinBackups?(handle: WorkspaceHandle): Promise<void>;
  readGlobalConfig(): Promise<GlobalConfigSnapshot>;
  /** Compare-and-swap by expected version. */
  writeGlobalConfig(
    value: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<{ applied: boolean; snapshot: GlobalConfigSnapshot }>;
  /** Returns `null` when a requested pick is cancelled. */
  openWorkspace(
    request?: OpenWorkspaceRequest,
  ): Promise<WorkspaceHandle | null>;
  /** Remember a successfully loaded workspace; paths remain host-private. */
  activateWorkspace?(handle: WorkspaceHandle): Promise<void>;
  /** Most recently opened first; filesystem locations remain host-private. */
  listWorkspaceHistory?(): Promise<WorkspaceHistoryEntry[]>;
  createWorkspace?(request: { name: string }): Promise<WorkspaceHandle | null>;
  updateWorkspaceHistory?(request: {
    id: string;
    pinned?: boolean;
    remove?: boolean;
  }): Promise<void>;
  readSnapshot(handle: WorkspaceHandle): Promise<WorkspaceHostSnapshot>;
  /** Read raw bytes for plain (non-canvas) files on demand. */
  readFile(handle: WorkspaceHandle, path: string): Promise<RawFileRead>;
  readResource(handle: WorkspaceHandle, key: string): Promise<RawFileRead>;
  openResourceExternal?(handle: WorkspaceHandle, path: string): Promise<void>;
  commit(
    handle: WorkspaceHandle,
    request: CommitRequest,
  ): Promise<CommitReceipt>;
  subscribe(
    handle: WorkspaceHandle,
    listener: (hint: ChangeHint) => void,
  ): () => void;
  resolveConflict(
    handle: WorkspaceHandle,
    request: ConflictResolution,
  ): Promise<CommitReceipt>;
  closeWorkspace(handle: WorkspaceHandle): Promise<void>;
  /** Desktop waits for the app to flush before closing; web best-effort. */
  onShutdown?(flush: () => Promise<void>): () => void;
}

export const WORKSPACE_META_DIR = '.verdscrolls';
export const LEGACY_WORKSPACE_META_DIR = '.verdboard';
export const LEGACY_RESOURCE_DIR = '.verd-resources';
export const RESOURCE_DIR = `${WORKSPACE_META_DIR}/resources`;

export const isProjectInternalPath = (path: string) =>
  path
    .split('/')
    .some((part) =>
      [
        WORKSPACE_META_DIR,
        LEGACY_WORKSPACE_META_DIR,
        LEGACY_RESOURCE_DIR,
      ].includes(part),
    );

/** Also accepts the historical logical URI path without exposing its storage. */
export const normalizeResourceKey = (input: string): string => {
  const key = input.startsWith(`${LEGACY_RESOURCE_DIR}/`)
    ? input.slice(LEGACY_RESOURCE_DIR.length + 1)
    : input;
  if (
    !/^(assets|history)\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key) ||
    key.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error('Invalid resource key: ' + input);
  return key;
};

export const resourceStoragePath = (key: string) =>
  `${RESOURCE_DIR}/${normalizeResourceKey(key)}`;
export const CANVAS_FILE_SUFFIX = '.verd.json';
export const DOCUMENT_FILE_SUFFIX = '.verd-doc.json';

export const isCanvasPath = (path: string) => path.endsWith(CANVAS_FILE_SUFFIX);
export const isDocumentPath = (path: string) =>
  path.endsWith(DOCUMENT_FILE_SUFFIX);

const SEGMENT = /^[^/\\]+$/;
const RESERVED = new Set([
  WORKSPACE_META_DIR,
  LEGACY_WORKSPACE_META_DIR,
  LEGACY_RESOURCE_DIR,
]);

/**
 * App-facing paths are workspace-relative POSIX paths. They can never escape
 * the root or reach into either current or legacy internal metadata area.
 */
export const normalizeWorkspacePath = (path: string): string => {
  if (typeof path !== 'string' || !path) throw new Error('Empty path');
  const normalized = path
    .split('/')
    .filter((part) => part !== '.' && part !== '')
    .join('/');
  if (!normalized || normalized.split('/').some((part) => !SEGMENT.test(part)))
    throw new Error(`Invalid workspace path: ${path}`);
  const segments = normalized.split('/');
  if (
    segments.some((part) => part === '..') ||
    segments.some((segment) => RESERVED.has(segment)) ||
    segments[0].includes(':')
  )
    throw new Error(`Workspace path escapes the root: ${path}`);
  return normalized;
};

/** Trash identifiers are single internal directory names, never paths. */
export const normalizeTrashEntryId = (entryId: string): string => {
  if (
    typeof entryId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entryId)
  )
    throw new Error('Invalid trash entry identifier');
  return entryId;
};

export const parentWorkspacePath = (path: string): string | null => {
  const at = path.lastIndexOf('/');
  return at < 0 ? null : path.slice(0, at);
};

export const baseName = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
};

/**
 * Conflict resolution expressed as one commit, so hosts apply it atomically:
 * - load-disk: no write; the app re-reads and retracts half-published results
 *   that still equal its own transaction's `after` versions.
 * - keep-local: the current disk bytes move to trash and the local content
 *   publishes as a fresh create inside the same commit.
 * - save-copy: local bytes publish at a new path that must not exist.
 */
export const conflictCommit = (
  request: ConflictResolution,
  diskVersion?: FileVersion,
): CommitRequest => {
  if (request.action === 'keep-local' && request.content !== undefined) {
    return {
      transactionId: request.transactionId,
      trash: diskVersion
        ? [{ path: request.path, expectedVersion: diskVersion }]
        : undefined,
      writes: [
        {
          path: request.path,
          content: request.content,
          expectedVersion: null,
        },
      ],
    };
  }
  if (
    request.action === 'save-copy' &&
    request.toPath &&
    request.content !== undefined
  ) {
    return {
      transactionId: request.transactionId,
      writes: [
        {
          path: request.toPath,
          content: request.content,
          expectedVersion: null,
        },
      ],
    };
  }
  return { transactionId: request.transactionId };
};
