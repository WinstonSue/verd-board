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

export interface WorkspaceTabRef {
  /** Stable file identity — canvas root frame id or document id. */
  fileId: CellId;
}

export interface WorkspaceSessionState {
  /** Tab order by stable file identity. */
  tabs: WorkspaceTabRef[];
  activeTabId: CellId | null;
  expandedDirs: string[];
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
  const tabs: WorkspaceTabRef[] = [];
  for (const tab of candidate.tabs) {
    const fileId =
      typeof tab?.fileId === 'string'
        ? tab.fileId
        : typeof tab?.frameId === 'string'
          ? tab.frameId
          : null;
    if (fileId === null) return null;
    tabs.push({ fileId });
  }
  return {
    tabs,
    activeTabId:
      typeof candidate.activeTabId === 'string' ? candidate.activeTabId : null,
    expandedDirs: Array.isArray(candidate.expandedDirs)
      ? candidate.expandedDirs.filter(
          (dir): dir is string => typeof dir === 'string',
        )
      : [],
  };
};

export interface WorkspaceEntryMeta {
  /** Workspace-relative POSIX path. */
  path: string;
  kind: 'file' | 'directory';
  /** `*.verd.json` payload files. */
  canvas: boolean;
  /** `*.verd-doc.json` payload files; absent means "detect by suffix". */
  document?: boolean;
  version?: FileVersion;
  size?: number;
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
  config: WorkspaceConfigSnapshot;
  session: WorkspaceSessionState | null;
  entries: WorkspaceEntryMeta[];
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
  /** Stable id; retries with the same id return the original receipt. */
  transactionId: string;
  writes?: FileWriteOp[];
  moves?: FileMoveOp[];
  mkdirs?: string[];
  /** Move files or directories into the trash area. */
  trash?: TrashOp[];
  /** Restore a trashed entry to its original or a given path. */
  restore?: RestoreOp[];
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
  trashEntries?: { path: string; entryId: string }[];
}

export interface OpenWorkspaceRequest {
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

export interface WorkspaceHost {
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
  readSnapshot(handle: WorkspaceHandle): Promise<WorkspaceHostSnapshot>;
  /** Read raw bytes for plain (non-canvas) files on demand. */
  readFile(handle: WorkspaceHandle, path: string): Promise<RawFileRead>;
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

export const WORKSPACE_META_DIR = '.verdboard';
export const CANVAS_FILE_SUFFIX = '.verd.json';
export const DOCUMENT_FILE_SUFFIX = '.verd-doc.json';

export const isCanvasPath = (path: string) => path.endsWith(CANVAS_FILE_SUFFIX);
export const isDocumentPath = (path: string) =>
  path.endsWith(DOCUMENT_FILE_SUFFIX);

const SEGMENT = /^[^/\\]+$/;
const RESERVED = new Set([WORKSPACE_META_DIR]);

/**
 * App-facing paths are workspace-relative POSIX paths. They can never escape
 * the root or reach into the internal `.verdboard` area.
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
    RESERVED.has(segments[0]) ||
    segments[0].includes(':')
  )
    throw new Error(`Workspace path escapes the root: ${path}`);
  return normalized;
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
