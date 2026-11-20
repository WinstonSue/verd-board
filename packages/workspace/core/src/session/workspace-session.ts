import { createGitVersionProvider } from '../git/version-provider';
import type {
  VersionRequest,
  VersionResult,
  WorkspaceVersionHost,
} from '../host/workspace-versions';
import {
  findFoldersById,
  folderIdentityWrite,
  isFolderIdentityPath,
} from '../host/folder-identity';
import { pruneWorkspaceTabs } from './workspace-navigation';
import {
  validateWorkspaceResources,
  workspaceAssetPath,
  WORKSPACE_PACKAGE_MAX_BYTES,
  WORKSPACE_PACKAGE_MAX_ENTRIES,
  type WorkspaceResource,
} from '../documents/workspace-package';
import {
  workspaceSkillDefinition,
  customSkillDefinition,
  parseWorkspaceSkill,
  type WorkspaceSkillCommit,
} from '../workspace-skills';
import {
  topLevelPaths,
  remapOrganization,
  readOrganization,
} from './organization';
import type { CellId, CellRegistry, CellStore } from '@sue/board-core';
import {
  isDocumentCell,
  isFrameReferenceCell,
  type DocumentFrameCell,
  type DocumentReferenceCell,
  type FrameReferenceCell,
} from '@sue/board-core';
import {
  documentPathFor,
  isDocumentFileV1,
  isWorkspaceFile,
  renameDocumentFile,
  workspaceFileId,
  type DocumentFileV1,
  type WorkspaceFile,
} from '../documents/document-files';
import {
  buildWorkspaceReferenceGraph,
  remapWorkspaceFiles,
  validateWorkspaceReferences,
  workspaceFileClosure,
  type WorkspaceReferenceGraph,
} from '../documents/workspace-references';
import {
  assembleWorkspaceStore,
  buildFrameReferenceGraph,
  frameClosure,
  isFrameFileV2,
  partitionCellStore,
  sameFrameFile,
  diagramKindOf,
  validateFrameFiles,
  type FrameFileDiagnostic,
  type FrameFileV2,
  type FrameReferenceGraph,
} from '../frames/frame-files';
import { createWorkspaceCellRegistry } from '../frames/plugins';
import {
  baseName,
  normalizeResourceKey,
  LEGACY_RESOURCE_DIR,
  CANVAS_FILE_SUFFIX,
  DOCUMENT_FILE_SUFFIX,
  isCanvasPath,
  isDocumentPath,
  normalizeTrashEntryId,
  normalizeWorkspacePath,
  normalizeWorkspaceSessionState,
  parentWorkspacePath,
  type CommitReceipt,
  type CommitRequest,
  type FileMoveOp,
  type FileVersion,
  type FileWriteOp,
  type RestoreOp,
  type TrashOp,
  type WorkspaceEntryMeta,
  type WorkspaceHandle,
  type WorkspaceHost,
  type WorkspaceHostSnapshot,
  type WorkspaceSessionState,
  type WorkspaceTrashMeta,
} from '../host/workspace-host';
import type { SaveStatus } from './save-status';
import type {
  WorkspaceGitRequest,
  WorkspaceGitResult,
} from '../host/workspace-git';
import {
  createFilePersistence,
  type FilePersistenceState,
} from './file-persistence';
import {
  readWorkspaceFiles,
  type FailedWorkspaceFile,
} from './workspace-file-load';
export type { FilePersistenceState } from './file-persistence';
export type { FailedWorkspaceFile } from './workspace-file-load';

/** Authoritative per-file state inside a session. */
export interface WorkspaceFileEntry<F extends WorkspaceFile = WorkspaceFile> {
  file: F;
  path: string;
  /** Last known disk digest; undefined for files never committed. */
  version?: FileVersion;
  dirty: boolean;
  /** A host rejection left local and disk versions diverged. */
  conflicted?: boolean;
  diagnostic?: string;
}

/** File-identifying command input; `frameId` stays accepted at the boundary. */
type FileRefInput = { fileId?: CellId; frameId?: CellId };

/** Extra history metadata document editors attach to one commit. */
export interface HistoryMeta {
  /** Runtime view/occurrence that authored this edit; never serialized. */
  origin?: DocumentEditOrigin;
  /** Consecutive entries sharing this key merge into one undo step. */
  group?: string;
  /** Opaque editor selection before/after the edit, restored on undo. */
  selectionBefore?: unknown;
  selectionAfter?: unknown;
  /** Operation name shown in undo UI (input, format, move…). */
  name?: string;
}
export interface DocumentEditOrigin {
  canvasId: CellId;
  cellId: CellId;
  instanceId: string;
}

/** Every content and file mutation funnels through these commands. */
export type WorkspaceCommand =
  | {
      /** One final candidate, validated once and saved as one transaction. */
      type: 'batch';
      files: { file: WorkspaceFile; path: string }[];
      /** Native files and binary assets publish together in one conditional commit. */
      resources?: readonly WorkspaceResource[];
      removeIds?: CellId[];
      /** Explicit repairs preserve the rejected disk bytes in workspace trash. */
      repairPaths?: string[];
      label?: string;
    }
  | {
      type: 'create-document-frame';
      ownerFrameId: CellId;
      document: DocumentFileV1;
      cell: DocumentFrameCell;
      label?: string;
    }
  | {
      type: 'store';
      /** Canvas-authored assembled store (workspace virtual root). */
      store: CellStore;
      label?: string;
      /** Directory for files whose roots appear for the first time. */
      defaultDir?: string;
    }
  | {
      type: 'file';
      file: WorkspaceFile;
      label?: string;
      history?: HistoryMeta;
    }
  | {
      type: 'create-file';
      file: WorkspaceFile;
      path?: string;
      label?: string;
      /**
       * First-launch seeding is not a user edit. Pass `false` so opening a
       * new workspace does not leave Undo enabled.
       */
      recordHistory?: boolean;
    }
  | ({ type: 'move-file'; toPath: string; label?: string } & FileRefInput)
  /** Atomic document rename: title and `*.verd-doc.json` path together. */
  | {
      type: 'organize-entries';
      moves?: { from: string; to: string }[];
      trashPaths?: string[];
      restores?: { entryId: string; toPath: string }[];
      navigation?: unknown;
      label?: string;
    }
  | { type: 'move-directory'; path: string; toPath: string; label?: string }
  | { type: 'rename-canvas'; fileId: CellId; title: string; label?: string }
  | { type: 'rename-document'; fileId: CellId; title: string; label?: string }
  | ({ type: 'trash-file'; label?: string } & FileRefInput)
  | { type: 'restore-file'; entryId: string; toPath?: string; label?: string }
  | { type: 'trash-directory'; path: string; label?: string }
  | { type: 'purge-trash'; entryIds: string[] }
  /**
   * Independent copy: clones the file and its actual embedded reference closure.
   */
  | ({
      type: 'duplicate-file';
      dir?: string;
      label?: string;
    } & FileRefInput)
  /**
   * Independent copy of one embedded occurrence: clones the reference's
   * target closure and inserts a sibling reference next to the original.
   */
  | {
      type: 'duplicate-reference';
      ownerFrameId: CellId;
      refId: CellId;
      label?: string;
    }
  /** Imports files (bundle or single), remapping colliding identities. */
  | {
      type: 'import-files';
      resources?: readonly WorkspaceResource[];
      files: WorkspaceFile[];
      dir?: string;
      label?: string;
    }
  /**
   * One instance edit. Replaces the source file and files created by the
   * edit; every other workspace file stays. Nested frames are externalized
   * and are never stored inside `FrameFileV2.cells`.
   */
  | {
      type: 'edit-file';
      sourceFileId: CellId;
      store: CellStore;
      /** Explicit owner for specialized diagrams created by this edit. */
      label?: string;
      history?: HistoryMeta;
    }
  /** Cross-file move. Each listed file may change; others must not. */
  | {
      type: 'edit-files';
      edits: {
        sourceFileId: CellId;
        store: CellStore;
      }[];
      label?: string;
      history?: HistoryMeta;
    };

export interface CommandResult {
  ok: boolean;
  diagnostics: FrameFileDiagnostic[];
  /**
   * Set by undo/redo when the replayed entry should surface a file:
   * the app activates its tab and restores any editor selection.
   */
  restored?: {
    fileId: CellId;
    selection?: unknown;
    origin?: DocumentEditOrigin;
  };
}

interface PendingSave {
  writes: Map<string, FileWriteOp>;
  mkdirs: string[];
  moves: FileMoveOp[];
  trash: TrashOp[];
  restore: RestoreOp[];
  config?: { value: Record<string, unknown>; expectedVersion: number };
  session?: WorkspaceSessionState;
}

interface FileSnapshot {
  file: WorkspaceFile;
  path: string;
}

interface HistoryEntry {
  storage?: {
    undo: Extract<WorkspaceCommand, { type: 'organize-entries' }>;
    redo: Extract<WorkspaceCommand, { type: 'organize-entries' }>;
  };
  /** Whole-subtree operations replay via host trash/restore, including raw files. */
  subtree?: { action: 'trash' | 'restore'; path: string; entryId: string };
  origin?: DocumentEditOrigin;
  label?: string;
  /** Operation name for undo UI; falls back to `label`. */
  name?: string;
  /** File to activate when this entry replays. */
  primaryFileId?: CellId;
  /** Merge key: consecutive same-key edits collapse into one undo step. */
  group?: string;
  /** Editor selection restore points, opaque to the session. */
  selection?: { fileId: CellId; before?: unknown; after?: unknown };
  /** fileId -> file+path before the command; undefined = absent. */
  before: Map<CellId, FileSnapshot | undefined>;
  after: Map<CellId, FileSnapshot | undefined>;
}

export interface WorkspaceSessionSnapshot {
  /** File-only feedback; navigation/configuration commits never dirty these states. */
  filePersistence: ReadonlyMap<CellId, FilePersistenceState>;
  store: CellStore;
  /** Failed disk files remain visible without entering the shared canvas store. */
  failedFiles: ReadonlyMap<string, FailedWorkspaceFile>;
  /** Canvas files only — kept for existing consumers. */
  files: ReadonlyMap<CellId, WorkspaceFileEntry<FrameFileV2>>;
  /** Standalone document files. */
  documents: ReadonlyMap<CellId, WorkspaceFileEntry<DocumentFileV1>>;
  fileIdByPath: ReadonlyMap<string, CellId>;
  graph: FrameReferenceGraph;
  references: WorkspaceReferenceGraph;
  /** Content and file commands pause during atomic storage operations. */
  mutationsPaused: boolean;
  /** Retry the retained trash transaction before allowing more edits. */
  trashUnconfirmed: boolean;
  session: WorkspaceSessionState;
  /** Raw host entries (directories, non-canvas files) for the tree view. */
  entries: WorkspaceEntryMeta[];
  resources?: WorkspaceHostSnapshot['resources'];
  trash: WorkspaceTrashMeta[];
  agent?: WorkspaceHostSnapshot['agent'];
  context?: WorkspaceHostSnapshot['context'];
  config: { version: number; value: Record<string, unknown> };
  /** Last confirmed config, excluding form drafts awaiting persistence. */
  savedConfig?: { version: number; value: Record<string, unknown> };
  diagnostics: FrameFileDiagnostic[];
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saveStatus: SaveStatus;
}

export interface WorkspaceSession {
  /** Git operations share the canonical save barrier and reload authoritative host state. */
  /** Compatibility/admin API; product content uses versions(). */
  git(request: WorkspaceGitRequest): Promise<WorkspaceGitResult>;
  versions(request: VersionRequest): Promise<VersionResult>;
  versionDiagnostic(): string | undefined;
  /** Stable between changes; published snapshots and their values are read-only. */
  getState(): WorkspaceSessionSnapshot;
  readRawFile(
    path: string,
  ): Promise<import('../host/workspace-host').RawFileRead>;
  commitResources(
    writes: FileWriteOp[],
    liveFileIds?: readonly string[],
  ): Promise<CommitReceipt>;
  /** Standard workspace Skills, saved outside canvas/document undo history. */
  commitWorkspaceSkills(request: WorkspaceSkillCommit): Promise<CommitReceipt>;
  apply(command: WorkspaceCommand): Promise<CommandResult>;
  undo(): Promise<CommandResult>;
  redo(): Promise<CommandResult>;
  /** Re-reads the host snapshot and merges external changes. */
  syncFromHost(): Promise<void>;
  /** Navigation/tab/tree state: saved but never part of undo history. */
  setSessionState(next: WorkspaceSessionState): void;
  /** Workspace-level config (identity, mind default width…), CAS-guarded. */
  setWorkspaceConfig(value: Record<string, unknown>): void;
  /** Creates an empty directory; lightweight, not part of undo history. */
  mkdir(path: string): CommandResult;
  ensureFolderId(path: string): Promise<string>;
  /**
   * Resolves a diverged file explicitly: `keep-local` trashes the disk
   * version and publishes local content; `load-disk` adopts the disk
   * version (recorded in history so the discarded edit stays undoable).
   */
  resolveConflict(
    fileId: CellId,
    action: 'keep-local' | 'load-disk' | 'save-copy',
  ): Promise<CommandResult>;
  /** The file plus its transitive dependency closure, for export. */
  exportFiles(frameId: CellId): FrameFileV2[];
  exportWorkspaceFiles(fileId: CellId): WorkspaceFile[];
  /** One document file for export; `null` when unknown or not a document. */
  exportDocument(fileId: CellId): DocumentFileV1 | null;
  /**
   * Resolves `true` once everything enqueued at call time has committed.
   * `false` means uncommitted content, conflicts or write errors remain —
   * callers must not treat the workspace as clean.
   */
  flush(): Promise<boolean>;
  /** Whole-workspace read-only: library and sources stay visible. */
  setReadonly(readonly: boolean): void;
  retryTrashOperation(): Promise<CommandResult>;
  /**
   * Blocks new content commands (desktop close). The save queue keeps
   * draining; `unfreeze` restores editing after a failed close.
   */
  freeze(): void;
  unfreeze(): void;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export interface WorkspaceSessionOptions {
  registry?: CellRegistry;
  /** Autosave debounce. */
  delayMs?: number;
  createId?: () => string;
  onStatus?: (status: SaveStatus) => void;
  onCommitted?: (savedAt: number) => void;
}

const EMPTY_SESSION: WorkspaceSessionState = {
  tabs: [],
  activeTabId: null,
  expandedDirs: [],
};

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Math.random().toString(36).slice(2)}`;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const sameFile = (left: WorkspaceFile, right: WorkspaceFile) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

const fileRef = (input: FileRefInput): CellId | undefined =>
  input.fileId ?? input.frameId;

/** Deterministic file name per kind, deduplicated inside a dir. */
const workspacePathFor = (
  file: WorkspaceFile,
  dir: string,
  taken: ReadonlySet<string>,
): string =>
  file.format === 'verd-frame'
    ? canvasPathFor(file, dir, taken)
    : documentPathFor(file, dir, taken);

interface PlanWrite {
  frameId: CellId;
  op: FileWriteOp;
}

interface PlanMove {
  frameId: CellId;
  op: FileMoveOp;
}

interface PlanTrash {
  frameId: CellId;
  op: TrashOp;
}

/** Ops are ordered for the hosts' fixed execution: trash -> move -> write. */
interface Plan {
  candidate: Map<CellId, FileSnapshot>;
  affected: Set<CellId>;
  writes: PlanWrite[];
  moves: PlanMove[];
  trashes: PlanTrash[];
}

/** Deterministic file name from the root frame, deduplicated inside a dir. */
const defaultCanvasTitle = (file: FrameFileV2) =>
  ({
    canvas: '未命名画布',
    mind: '未命名思维导图',
    workflow: '未命名流程图',
    architecture: '未命名架构图',
    'uml-class': '未命名 UML 类图',
    'uml-sequence': '未命名 UML 时序图',
  })[diagramKindOf(file)];
const canvasPathFor = (
  file: FrameFileV2,
  dir: string,
  taken: ReadonlySet<string>,
): string => {
  const title = (file.frame.name || defaultCanvasTitle(file)).replace(
    /[/\\]/g,
    '-',
  );
  for (let index = 1; ; index += 1) {
    const name =
      index === 1
        ? `${title}${CANVAS_FILE_SUFFIX}`
        : `${title} ${index}${CANVAS_FILE_SUFFIX}`;
    const candidate = dir ? `${dir}/${name}` : name;
    if (!taken.has(candidate)) return candidate;
  }
};

const invalid = (message: string, frameId?: CellId): CommandResult => ({
  ok: false,
  diagnostics: [{ frameId, message }],
});

/**
 * The single authority for workspace content. All mutations run the same
 * pipeline: build a candidate file map -> validate structure, identity and
 * the reference graph -> commit memory plus one history entry -> enqueue the
 * affected files into the only save channel. Undo/redo replay inverse
 * candidates through the same pipeline, so invalid states can never be
 * reached by either direction.
 */
export const createWorkspaceSession = (options: {
  host: WorkspaceHost;
  handle: WorkspaceHandle;
  registry?: CellRegistry;
  delayMs?: number;
  createId?: () => string;
  onStatus?: (status: SaveStatus) => void;
  onCommitted?: (savedAt: number) => void;
  files: Map<CellId, WorkspaceFileEntry>;
  agent?: WorkspaceHostSnapshot['agent'];
  context?: WorkspaceHostSnapshot['context'];
  config: { version: number; value: Record<string, unknown> };
  session: WorkspaceSessionState | null;
  trash: WorkspaceTrashMeta[];
  entries?: WorkspaceEntryMeta[];
  resources?: WorkspaceHostSnapshot['resources'];
  diagnostics: FrameFileDiagnostic[];
  failedFiles?: ReadonlyMap<string, FailedWorkspaceFile>;
}): WorkspaceSession => {
  const { host, handle } = options;
  const registry = options.registry ?? createWorkspaceCellRegistry();
  const delayMs = options.delayMs ?? 400;
  const createId = options.createId ?? uuid;

  const files = new Map<CellId, WorkspaceFileEntry>(
    [...options.files].map(([id, entry]) => {
      const copy = clone(entry);
      if (copy.file.format === 'verd-frame') delete copy.file.organization;
      return [id, copy];
    }),
  );
  let context = options.context;
  let config = clone(options.config);
  let agent = options.agent ? clone(options.agent) : undefined;
  let session = options.session ? clone(options.session) : clone(EMPTY_SESSION);
  let trash = [...options.trash];
  let entries = [...(options.entries ?? [])];
  let resources = [...(options.resources ?? [])];
  const resourceMetaAt = (path: string) =>
    resources.find((entry) => entry.key === normalizeResourceKey(path));
  const readRawFile = (path: string) =>
    path.startsWith(LEGACY_RESOURCE_DIR + '/')
      ? host
          .readResource(handle, normalizeResourceKey(path))
          .then((raw) => ({ ...raw, path }))
      : host.readFile(handle, normalizeWorkspacePath(path));
  let diagnostics = [...options.diagnostics];
  let failedFiles = new Map(options.failedFiles);
  let loadDiagnostics = [...options.diagnostics];
  const clearLoadFailure = (path: string) => {
    failedFiles.delete(path);
    const cleared = new Set(
      loadDiagnostics.filter((issue) => issue.path === path),
    );
    diagnostics = diagnostics.filter((issue) => !cleared.has(issue));
    loadDiagnostics = loadDiagnostics.filter((issue) => issue.path !== path);
  };
  let store: CellStore;
  let graph: FrameReferenceGraph;
  let references: WorkspaceReferenceGraph;
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  // Track identities at the actual removal, so reusing a path for a different
  // live file does not make its unrelated history a purge target.
  const trashIdentities = new Map<string, Set<CellId>>();
  const trashOpIdentities = new WeakMap<TrashOp, Set<CellId>>();
  const rebaseTrash = (op: TrashOp, expectedVersion: FileVersion): TrashOp => {
    const next = { ...op, expectedVersion };
    const identities = trashOpIdentities.get(op);
    if (identities) trashOpIdentities.set(next, identities);
    return next;
  };
  const pending: PendingSave = {
    writes: new Map(),
    mkdirs: [],
    moves: [],
    trash: [],
    restore: [],
  };
  const filePersistence = createFilePersistence(files, () => pending.writes);
  /** A failed indeterminate commit is retried with the same transactionId. */
  let retryCommit: CommitRequest | null = null;
  let importPending: {
    request: CommitRequest;
    plan: Plan;
    label?: string;
    recordHistory: boolean;
  } | null = null;
  let importFlight: Promise<CommandResult> | null = null;
  let skillRetry: { key: string; request: WorkspaceSkillCommit } | null = null;
  /** External sync is deferred while commits or restores are in flight. */
  let syncQueued = false;
  let syncReadId = 0;
  let suspendSync = 0;
  let saveStatus: SaveStatus = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inflight: Promise<boolean> | null = null;
  let disposed = false;
  /** Desktop close: new content commands rejected while the queue drains. */
  let frozen = false;
  let workspaceReadonly = false;
  /** Organization batch: content and file mutations wait; navigation does not. */
  let mutationsPaused = false;
  let gitFlight = false;
  let gitOperation: Promise<unknown> | null = null;
  let versionDiagnostic: string | undefined;
  const versionHost: WorkspaceVersionHost =
    host.versions ??
    (host.git
      ? createGitVersionProvider(host.git.bind(host))
      : async () => ({
          status: {
            available: false,
            enabled: false,
            token: '',
            changes: [],
            capabilities: {
              create: false,
              restore: false,
              directory: false,
              cleanup: false,
              sync: false,
            },
          },
        }));
  const gitPurgeTargets = new Map<
    string,
    { ids: Set<string>; trash: Set<string> }
  >();
  type StorageCommand =
    | Extract<
        WorkspaceCommand,
        { type: 'trash-directory' | 'restore-file' | 'purge-trash' }
      >
    | { type: 'trash-path'; path: string; label?: string };
  let storageRetry: {
    key: string;
    request: CommitRequest;
    paths: string[];
    before: HistoryEntry['before'];
    resume(): Promise<CommandResult>;
  } | null = null;
  const listeners = new Set<() => void>();
  let cachedSnapshot: WorkspaceSessionSnapshot | undefined;
  let canvasEntries = new Map<CellId, WorkspaceFileEntry<FrameFileV2>>();
  let documentEntries = new Map<CellId, WorkspaceFileEntry<DocumentFileV1>>();
  const invalidateSnapshot = () => {
    cachedSnapshot = undefined;
  };

  const rebuildDerived = (canvasChanged = true) => {
    invalidateSnapshot();
    // The canvas store and reference graph only ever see frame files;
    // documents are peers, never cells or reference targets.
    const frameList = [...files.values()]
      .map((entry) => entry.file)
      .filter((file): file is FrameFileV2 => file.format === 'verd-frame');
    if (canvasChanged) {
      store = assembleWorkspaceStore(frameList, registry).store;
      graph = buildFrameReferenceGraph(frameList);
    }
    references = buildWorkspaceReferenceGraph(
      [...files.values()].map((entry) => entry.file),
    );
  };
  rebuildDerived();

  const emit = () => {
    invalidateSnapshot();
    listeners.forEach((listener) => listener());
  };

  const preparedResourceRequests = new WeakSet<CommitRequest>();
  const commitFiles = async (request: CommitRequest) => {
    const historyPath = '.verd-resources/history/index.json';
    if (
      !preparedResourceRequests.has(request) &&
      (request.trash?.length || request.purge?.length) &&
      resourceMetaAt(historyPath)
    ) {
      const raw = await readRawFile(historyPath);
      const history = JSON.parse(new TextDecoder().decode(raw.content)) as {
        version: number;
        revisions: { fileId: string; path: string }[];
        trashed?: Record<string, string[]>;
      };
      if (history.version !== 1 || !Array.isArray(history.revisions))
        throw new Error(
          'History manifest is corrupt; repair it before permanently deleting files',
        );
      history.trashed ??= {};
      for (const operation of request.trash ?? [])
        history.trashed[operation.path] = [
          ...new Set([
            ...(trashOpIdentities.get(operation) ?? []),
            ...[...files]
              .filter(
                ([, entry]) =>
                  entry.path === operation.path ||
                  entry.path.startsWith(operation.path + '/'),
              )
              .map(([id]) => id),
          ]),
        ];
      const purgedIds = new Set(
        (request.purge ?? []).flatMap((entryId) => {
          const original = trash.find(
            (item) => item.entryId === entryId,
          )?.originalPath;
          return [
            ...(trashIdentities.get(entryId) ?? []),
            ...(original ? (history.trashed?.[original] ?? []) : []),
          ];
        }),
      );
      const writes: FileWriteOp[] = [];
      for (const revision of history.revisions.filter((item) =>
        purgedIds.has(item.fileId),
      )) {
        if (
          !/^\.verd-resources\/history\/[a-zA-Z0-9-]+\.snapshot\.json$/.test(
            revision.path,
          )
        )
          throw new Error('Invalid history snapshot path');
        if (resourceMetaAt(revision.path)) {
          const original = await readRawFile(revision.path);
          writes.push({
            path: revision.path,
            content: JSON.stringify({ purged: true }),
            expectedVersion: original.version,
          });
        }
      }
      history.revisions = history.revisions.filter(
        (item) => !purgedIds.has(item.fileId),
      );
      writes.push({
        path: historyPath,
        content: JSON.stringify(history),
        expectedVersion: raw.version,
      });
      request.resourceWrites = [
        ...(request.resourceWrites ?? []),
        ...writes.map((write) => ({
          ...write,
          path: normalizeResourceKey(write.path),
        })),
      ];
      preparedResourceRequests.add(request);
    }
    const attempt = filePersistence.begin(request);
    if (attempt.members.size) emit();
    try {
      const receipt = await host.commit(handle, request);
      if (receipt.outcome === 'applied') {
        for (const write of request.resourceWrites ?? []) {
          const key = normalizeResourceKey(write.path);
          const version = receipt.resourceVersions?.[key];
          if (version)
            resources = [
              ...resources.filter((entry) => entry.key !== key),
              {
                key,
                version,
                size:
                  typeof write.content === 'string'
                    ? new TextEncoder().encode(write.content).length
                    : write.content.length,
              },
            ];
        }
      }
      filePersistence.finish(attempt, receipt.outcome === 'applied');
      invalidateSnapshot();
      return receipt;
    } catch (error) {
      filePersistence.finish(attempt, false);
      invalidateSnapshot();
      throw error;
    }
  };

  const setStatus = (next: SaveStatus) => {
    if (saveStatus === next) return;
    saveStatus = next;
    // Status callbacks may synchronously inspect the session before emit.
    invalidateSnapshot();
    options.onStatus?.(next);
    emit();
  };

  const fileIdByPath = () => {
    const map = new Map<string, CellId>();
    files.forEach((entry, id) => map.set(entry.path, id));
    return map;
  };

  const takenPaths = (except?: CellId) => {
    const exceptPath = except ? files.get(except)?.path : undefined;
    const taken = new Set(
      entries
        .filter((entry) => entry.path !== exceptPath)
        .map((entry) => entry.path),
    );
    failedFiles.forEach((failure) => taken.add(failure.path));
    files.forEach((entry, id) => {
      if (id !== except) taken.add(entry.path);
    });
    return taken;
  };

  const hasPendingContent = () =>
    pending.writes.size > 0 ||
    pending.mkdirs.length > 0 ||
    pending.moves.length > 0 ||
    pending.trash.length > 0 ||
    pending.restore.length > 0 ||
    !!pending.config ||
    !!retryCommit;
  const hasPending = () => hasPendingContent() || !!pending.session;

  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush().catch(() => {});
    }, delayMs);
  };

  const markConflict = (receipt: CommitReceipt) => {
    invalidateSnapshot();
    const byPath = fileIdByPath();
    const frameId = receipt.path ? byPath.get(receipt.path) : undefined;
    if (frameId) {
      const entry = files.get(frameId);
      if (entry)
        files.set(frameId, {
          ...entry,
          conflicted: true,
          diagnostic: `Version conflict (${receipt.reason})`,
        });
    }
    diagnostics = [
      ...diagnostics,
      {
        frameId,
        path: receipt.path,
        message: `Commit rejected: ${receipt.reason ?? 'unknown'}${receipt.path ? ` at ${receipt.path}` : ''}`,
      },
    ];
  };

  /**
   * Applies post-commit versions and clears only the ops that were part of
   * the committed request — ops enqueued mid-flight stay pending (matched by
   * object identity). A committed path whose file vanished mid-flight (e.g.
   * create flushed, then locally trashed) is trashed again so no orphan is
   * left on disk.
   */
  const settleReceipt = (request: CommitRequest, receipt: CommitReceipt) => {
    /**
     * Chain mid-flight ops onto the versions this commit established. Runs
     * after the committed ops are removed, so only genuinely-newer queued
     * ops (enqueued while this commit was in flight) get their
     * expectedVersion bumped — bumping a committed op would break the
     * identity match that settles it and re-commit it forever.
     */
    const bumpPendingVersions = () => {
      const committedExpected = new Map<string, FileVersion | null>();
      (request.writes ?? []).forEach((op) =>
        committedExpected.set(op.path, op.expectedVersion),
      );
      committedExpected.forEach((expected, path) => {
        const version = receipt.versions?.[path];
        if (version === undefined) return;
        const pendingWrite = pending.writes.get(path);
        if (pendingWrite && pendingWrite.expectedVersion === expected)
          pending.writes.set(path, {
            ...pendingWrite,
            expectedVersion: version,
          });
        pending.moves = pending.moves.map((op) =>
          op.from === path && op.expectedVersion === expected
            ? { ...op, expectedVersion: version }
            : op,
        );
        pending.trash = pending.trash.map((op) =>
          op.path === path && op.expectedVersion === expected
            ? rebaseTrash(op, version)
            : op,
        );
      });
    };
    const byPath = fileIdByPath();
    Object.entries(receipt.versions ?? {}).forEach(([path, version]) => {
      // Folder identity writes belong to their directory and never enter file history.
      if (isFolderIdentityPath(path)) return;
      const frameId = byPath.get(path);
      const entry = frameId ? files.get(frameId) : undefined;
      if (entry && frameId && entry.path === path) {
        files.set(frameId, { ...entry, version });
        return;
      }
      // A rename queued mid-flight already moved this entry to its new
      // path — the committed version still belongs to that file.
      let destination = path;
      for (const move of pending.moves) {
        if (move.from === destination) destination = move.to;
      }
      const movedId =
        destination !== path ? byPath.get(destination) : undefined;
      const movedEntry = movedId ? files.get(movedId) : undefined;
      if (movedId && movedEntry) {
        files.set(movedId, { ...movedEntry, version });
        return;
      }
      pending.trash.push({ path, expectedVersion: version });
    });
    (receipt.trashEntries ?? []).forEach(({ path, entryId }) => {
      const op = request.trash?.find((item) => item.path === path);
      if (op)
        trashIdentities.set(entryId, trashOpIdentities.get(op) ?? new Set());
      if (!trash.some((entry) => entry.entryId === entryId))
        trash.push({ entryId, originalPath: path, trashedAt: Date.now() });
    });
    (request.writes ?? []).forEach((op) => {
      if (pending.writes.get(op.path) === op) pending.writes.delete(op.path);
    });
    const settled = <T>(ops: T[] | undefined) => new Set(ops ?? []);
    const moves = settled(request.moves);
    pending.moves = pending.moves.filter((op) => !moves.has(op));
    const trashes = settled(request.trash);
    pending.trash = pending.trash.filter((op) => !trashes.has(op));
    // Trash ops queued mid-flight captured the pre-commit version; re-base
    // them onto what was just applied or the next commit is rejected.
    Object.entries(receipt.versions ?? {}).forEach(([path, version]) => {
      pending.trash = pending.trash.map((op) =>
        op.path === path ? rebaseTrash(op, version) : op,
      );
    });
    const restores = settled(request.restore);
    pending.restore = pending.restore.filter((op) => !restores.has(op));
    const dirs = settled(request.mkdirs);
    pending.mkdirs = pending.mkdirs.filter((dir) => !dirs.has(dir));
    if (request.config) {
      config = {
        version: config.version + 1,
        value: clone(request.config.value),
      };
      if (pending.config === request.config) pending.config = undefined;
      else if (pending.config)
        pending.config = { ...pending.config, expectedVersion: config.version };
    }
    if (request.session && pending.session === request.session)
      pending.session = undefined;
    bumpPendingVersions();
    refreshDirty();
    // A receipt can settle between two commits without another status change.
    invalidateSnapshot();
    options.onCommitted?.(Date.now());
    emit();
  };

  /**
   * A file is dirty while uncommitted ops still target its path — or while it
   * is conflicted, since a rejected file keeps local content that diverges
   * from disk until an explicit resolve path runs.
   */
  const refreshDirty = () => {
    const moved = new Set(pending.moves.map((op) => op.to));
    files.forEach((entry, id) => {
      const dirty =
        pending.writes.has(entry.path) ||
        moved.has(entry.path) ||
        !!entry.conflicted;
      if (entry.dirty !== dirty) files.set(id, { ...entry, dirty });
    });
  };

  /**
   * A deterministic rejection dropped the whole commit. Remove the offending
   * file's queued ops so the rest of the queue keeps flowing, then mark the
   * file conflicted — per spec the diverged file stops overwriting until a
   * resolve path runs.
   */
  const dropRejectedOps = (receipt: CommitReceipt) => {
    if (receipt.path) {
      const frameId = fileIdByPath().get(receipt.path);
      if (frameId) {
        const entry = files.get(frameId);
        if (entry) pending.writes.delete(entry.path);
      }
      pending.moves = pending.moves.filter(
        (op) => op.from !== receipt.path && op.to !== receipt.path,
      );
      pending.trash = pending.trash.filter((op) => op.path !== receipt.path);
      const failedDir = isFolderIdentityPath(receipt.path)
        ? parentWorkspacePath(receipt.path)
        : receipt.path;
      if (failedDir && pending.mkdirs.includes(failedDir)) {
        pending.mkdirs = pending.mkdirs.filter((dir) => dir !== failedDir);
        pending.writes.delete(folderIdentityWrite(failedDir, '').path);
      }
      pending.restore = pending.restore.filter(
        (op) => op.toPath !== receipt.path,
      );
    }
    markConflict(receipt);
    refreshDirty();
  };

  /**
   * A pathless rejection means the request itself can never commit (a
   * malformed op or config). Drop exactly the ops that were in it —
   * dropping more would lose user edits, keeping them would spin forever.
   */
  const dropRequestOps = (request: CommitRequest) => {
    (request.writes ?? []).forEach((op) => {
      if (pending.writes.get(op.path) === op) pending.writes.delete(op.path);
    });
    const settled = <T>(ops: T[] | undefined) => new Set(ops ?? []);
    const moves = settled(request.moves);
    pending.moves = pending.moves.filter((op) => !moves.has(op));
    const trashes = settled(request.trash);
    pending.trash = pending.trash.filter((op) => !trashes.has(op));
    const restores = settled(request.restore);
    pending.restore = pending.restore.filter((op) => !restores.has(op));
    const dirs = settled(request.mkdirs);
    pending.mkdirs = pending.mkdirs.filter((dir) => !dirs.has(dir));
    if (request.config && pending.config === request.config)
      pending.config = undefined;
    if (request.session && pending.session === request.session)
      pending.session = undefined;
    refreshDirty();
  };

  const buildRequest = (transactionId: string): CommitRequest => {
    // Versions are stamped when the request is built, not when the ops were
    // queued — a commit applied in between leaves queued ops asserting a
    // version the disk no longer has, which reads as a false conflict.
    const paths = fileIdByPath();
    const versionAt = (path: string) => {
      const id = paths.get(path);
      const entry = id === undefined ? undefined : files.get(id);
      return entry && entry.path === path ? entry.version : undefined;
    };
    pending.writes.forEach((op, path) => {
      const version = versionAt(path);
      if (version !== undefined) op.expectedVersion = version;
    });
    pending.moves.forEach((op) => {
      const version = versionAt(op.to);
      if (version !== undefined) op.expectedVersion = version;
    });
    return {
      transactionId,
      writes: pending.writes.size ? [...pending.writes.values()] : undefined,
      mkdirs: pending.mkdirs.length ? [...pending.mkdirs] : undefined,
      moves: pending.moves.length ? [...pending.moves] : undefined,
      trash: pending.trash.length ? [...pending.trash] : undefined,
      restore: pending.restore.length ? [...pending.restore] : undefined,
      config: pending.config,
      session: pending.session,
    };
  };

  /**
   * Commits everything enqueued at call time (and anything arriving
   * mid-flight). The result reports the real outcome: `false` while
   * uncommitted ops, conflicts or write errors remain — it never throws
   * for I/O failures so close paths can retry the same transactions.
   */
  const flush = (): Promise<boolean> => {
    if (importPending)
      return confirmImport().then((result) => (result.ok ? flush() : false));
    if (storageRetry) return Promise.resolve(false);
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (inflight) return inflight;
    const run = (async () => {
      let failed = false;
      while (!disposed && hasPending()) {
        const request = retryCommit ?? buildRequest(`${createId()}-commit`);
        retryCommit = null;
        setStatus('saving');
        let receipt: CommitReceipt;
        try {
          receipt = await commitFiles(request);
        } catch (error) {
          retryCommit = request;
          setStatus('error');
          failed = true;
          break;
        }
        if (receipt.outcome === 'applied') {
          settleReceipt(request, receipt);
          continue;
        }
        if (receipt.reason === 'io-error') {
          // Unknown outcome: replay the same transactionId on the next flush.
          retryCommit = request;
          setStatus('error');
          failed = true;
          break;
        }
        failed = true;
        dropRejectedOps(receipt);
        if (!receipt.path) dropRequestOps(request);
        setStatus(hasPending() ? 'saving' : 'error');
      }
      const unresolved = [...files.values()].some(
        (entry) => entry.conflicted || entry.dirty,
      );
      if (!hasPending() && !disposed && saveStatus === 'saving')
        setStatus(unresolved ? 'error' : 'saved');
      return !failed && !hasPending() && !unresolved;
    })().finally(() => {
      inflight = null;
      drainSync();
    });
    inflight = run;
    return run;
  };

  /**
   * Diff candidate vs current: new files and content changes become writes,
   * path changes become moves, missing entries become trashes. A file that
   * was never persisted (no disk version) produces no host op for
   * move/trash — those paths are retargeted/dropped locally instead.
   */
  const planDiff = (
    candidate: Map<CellId, FileSnapshot>,
    repairPaths: ReadonlySet<string> = new Set(),
  ): Plan => {
    for (const [id, entry] of candidate) {
      if (entry.file.format !== 'verd-frame') continue;
      let file = entry.file;
      if (file.organization !== undefined) {
        file = { ...file };
        delete file.organization;
      }
      if (!files.has(id) && !file.frame.name)
        file = {
          ...file,
          frame: { ...file.frame, name: defaultCanvasTitle(file) },
        };
      if (file !== entry.file) candidate.set(id, { ...entry, file });
    }
    const plan: Plan = {
      candidate,
      affected: new Set(),
      writes: [],
      moves: [],
      trashes: [],
    };
    candidate.forEach((cand, id) => {
      const prev = files.get(id);
      if (!prev) {
        plan.affected.add(id);
        const failed = failedFiles.get(cand.path);
        if (failed && repairPaths.has(cand.path) && failed.version)
          plan.trashes.push({
            frameId: id,
            op: { path: cand.path, expectedVersion: failed.version },
          });
        plan.writes.push({
          frameId: id,
          op: {
            path: cand.path,
            content: JSON.stringify(cand.file, null, 2),
            expectedVersion: null,
          },
        });
        return;
      }
      const renamed = prev.path !== cand.path;
      const changed = !sameFile(prev.file, cand.file);
      if (!renamed && !changed) return;
      plan.affected.add(id);
      if (renamed) {
        if (prev.version === undefined) {
          // Never persisted: just retarget the pending create.
          pending.writes.delete(prev.path);
        } else {
          plan.moves.push({
            frameId: id,
            op: {
              from: prev.path,
              to: cand.path,
              expectedVersion: prev.version,
            },
          });
        }
      }
      if (changed || (renamed && prev.version === undefined))
        plan.writes.push({
          frameId: id,
          op: {
            path: cand.path,
            content: JSON.stringify(cand.file, null, 2),
            expectedVersion: prev.version ?? null,
          },
        });
    });
    files.forEach((entry, id) => {
      if (candidate.has(id)) return;
      plan.affected.add(id);
      if (entry.version === undefined) pending.writes.delete(entry.path);
      else
        plan.trashes.push({
          frameId: id,
          op: { path: entry.path, expectedVersion: entry.version },
        });
    });
    return plan;
  };

  /**
   * Validates a candidate file map exactly as a host snapshot would be:
   * frames run structure, identity and reference-graph checks; documents
   * run envelope checks and must hold unique file identities across both
   * kinds — a document can never be a frame reference target.
   */
  const validateCandidate = (
    plan: Pick<Plan, 'candidate'>,
    repairPaths: ReadonlySet<string> = new Set(),
  ): FrameFileDiagnostic[] => {
    for (const [id, candidate] of plan.candidate) {
      if (
        failedFiles.has(candidate.path) &&
        !repairPaths.has(candidate.path) &&
        files.get(id)?.path !== candidate.path
      )
        return [
          {
            frameId: id,
            path: candidate.path,
            message: 'Path is occupied by an unavailable file',
          },
        ];
      if (
        files.get(id)?.path !== candidate.path &&
        [...failedFiles.values()].some(
          (failure) =>
            failure.fileId === id &&
            !(
              failure.path === candidate.path && repairPaths.has(candidate.path)
            ),
        )
      )
        return [
          {
            frameId: id,
            message: 'Identity is occupied by an unavailable file',
          },
        ];
      if (
        files.get(id)?.path !== candidate.path &&
        entries.some(
          (entry) =>
            entry.path === candidate.path &&
            (entry.kind === 'directory' ||
              (!isCanvasPath(entry.path) && !isDocumentPath(entry.path))),
        )
      )
        return [
          { frameId: id, path: candidate.path, message: 'Path is occupied' },
        ];
    }
    const fileList = [...plan.candidate.values()].map((cand) => cand.file);
    const frames = fileList.filter(
      (file): file is FrameFileV2 => file.format === 'verd-frame',
    );
    const structure = validateFrameFiles(frames, registry);
    if (structure.length) return structure;
    const assembled = assembleWorkspaceStore(frames, registry);
    if (assembled.diagnostics.length) return assembled.diagnostics;
    const claimed = new Set<CellId>();
    frames.forEach((file) => {
      claimed.add(file.frame.id);
      Object.keys(file.cells).forEach((id) => claimed.add(id));
    });
    const diagnostics: FrameFileDiagnostic[] = [];
    const docIds = new Set<CellId>();
    fileList.forEach((file) => {
      if (file.format !== 'verd-document') return;
      if (!isDocumentFileV1(file)) {
        const id = (file as { id?: unknown }).id;
        diagnostics.push({
          frameId: typeof id === 'string' ? id : undefined,
          message: 'Invalid document file',
        });
        return;
      }
      if (claimed.has(file.id) || docIds.has(file.id))
        diagnostics.push({
          frameId: file.id,
          message: `Duplicate file identity: ${file.id}`,
        });
      else docIds.add(file.id);
      if (file.text.id !== file.id)
        diagnostics.push({
          frameId: file.id,
          message: 'Document body identity drifted from the file identity',
        });
    });
    return [...diagnostics, ...validateWorkspaceReferences(fileList)];
  };

  /**
   * Commits the plan into memory: file entries, save-queue ops, one history
   * entry. Memory and queue move together so an applied command is always
   * exactly one history entry and one persistence batch. Entries sharing a
   * group key merge — continuous typing is one undo step, not one per key.
   */
  const install = (
    plan: Plan,
    label?: string,
    recordHistory = true,
    meta?: HistoryMeta & { primaryFileId?: CellId },
  ) => {
    const canvasChanged = [...plan.affected].some(
      (id) =>
        files.get(id)?.file.format === 'verd-frame' ||
        plan.candidate.get(id)?.file.format === 'verd-frame',
    );
    const before: HistoryEntry['before'] = new Map();
    const after: HistoryEntry['after'] = new Map();
    plan.affected.forEach((id) => {
      const prev = files.get(id);
      before.set(
        id,
        prev ? { file: clone(prev.file), path: prev.path } : undefined,
      );
      const cand = plan.candidate.get(id);
      after.set(
        id,
        cand ? { file: clone(cand.file), path: cand.path } : undefined,
      );
    });
    plan.affected.forEach((id) => {
      const cand = plan.candidate.get(id);
      if (!cand) {
        files.delete(id);
        return;
      }
      const prev = files.get(id);
      files.set(id, {
        file: clone(cand.file),
        path: cand.path,
        version: prev?.version,
        dirty: true,
        conflicted: prev?.conflicted,
        diagnostic: prev?.diagnostic,
      });
    });
    plan.trashes.forEach(({ op, frameId }) => {
      failedFiles.delete(op.path);
      trashOpIdentities.set(op, new Set([frameId]));
      pending.trash.push(op);
    });
    plan.moves.forEach(({ op }) => {
      // Hosts execute moves before writes. A dirty file's queued write must
      // follow its new path; otherwise it asserts a version at the now-empty
      // old path and the entire save batch is rejected.
      const write = pending.writes.get(op.from);
      if (write) {
        pending.writes.delete(op.from);
        pending.writes.set(op.to, { ...write, path: op.to });
      }
      pending.moves.push(op);
    });
    plan.writes.forEach(({ op }) => pending.writes.set(op.path, op));
    // Keep the entry index in step for the tree; the next host sync
    // reconciles versions.
    plan.trashes.forEach(({ op }) => {
      entries = entries.filter(
        (entry) =>
          entry.path !== op.path && !entry.path.startsWith(`${op.path}/`),
      );
    });
    plan.moves.forEach(({ op }) => {
      entries = entries.map((entry) =>
        entry.path === op.from
          ? { ...entry, path: op.to }
          : entry.path.startsWith(`${op.from}/`)
            ? { ...entry, path: op.to + entry.path.slice(op.from.length) }
            : entry,
      );
    });
    plan.writes.forEach(({ op }) => {
      if (entries.some((entry) => entry.path === op.path)) return;
      entries = [
        ...entries,
        {
          path: op.path,
          kind: 'file',
          canvas: isCanvasPath(op.path),
          document: isDocumentPath(op.path) || undefined,
        },
      ];
    });
    rebuildDerived(canvasChanged);
    if (recordHistory && plan.affected.size) {
      const primaryFileId =
        meta?.primaryFileId ??
        (plan.affected.size === 1 ? [...plan.affected][0] : undefined);
      const last = undoStack.at(-1);
      const mergeable =
        meta?.group !== undefined &&
        last?.group === meta.group &&
        last.primaryFileId === primaryFileId;
      if (mergeable) {
        // Keep the first `before`, take the latest `after` per file.
        after.forEach((value, id) => last.after.set(id, value));
        before.forEach((value, id) => {
          if (!last.before.has(id)) last.before.set(id, value);
        });
        if (meta.selectionAfter !== undefined && last.selection)
          last.selection.after = meta.selectionAfter;
        last.label = label ?? last.label;
        last.name = meta?.name ?? last.name;
      } else {
        undoStack.push({
          origin: meta?.origin,
          label,
          name: meta?.name,
          primaryFileId,
          group: meta?.group,
          selection:
            primaryFileId !== undefined &&
            meta &&
            (meta.selectionBefore !== undefined ||
              meta.selectionAfter !== undefined)
              ? {
                  fileId: primaryFileId,
                  before: meta.selectionBefore,
                  after: meta.selectionAfter,
                }
              : undefined,
          before,
          after,
        });
      }
      redoStack.length = 0;
    }
    schedule();
    emit();
  };

  /** The candidate file map for each command. */
  const candidateFor = (
    command: WorkspaceCommand,
  ): { candidate: Map<CellId, FileSnapshot> } | CommandResult => {
    const candidate = new Map<CellId, FileSnapshot>();
    files.forEach((entry, id) =>
      candidate.set(id, { file: entry.file, path: entry.path }),
    );
    if (command.type === 'batch') {
      for (const id of command.removeIds ?? []) candidate.delete(id);
      const seen = new Set<string>();
      for (const entry of command.files) {
        if (!isWorkspaceFile(entry.file))
          return invalid('Invalid workspace file');
        const id = workspaceFileId(entry.file);
        if (seen.has(id)) return invalid('Repeated batch file identity', id);
        seen.add(id);
        const previous = files.get(id);
        if (previous && previous.file.format !== entry.file.format)
          return invalid('File kind cannot change', id);
        candidate.set(id, { file: clone(entry.file), path: entry.path });
      }
      const occupied = new Set<string>();
      for (const entry of candidate.values()) {
        if (occupied.has(entry.path)) return invalid('Repeated batch path');
        occupied.add(entry.path);
      }
      return { candidate };
    }
    if (command.type === 'create-document-frame') {
      const owner = files.get(command.ownerFrameId);
      const document = command.document;
      if (
        !owner ||
        owner.file.format !== 'verd-frame' ||
        !isDocumentFileV1(document) ||
        files.has(document.id) ||
        command.cell.data.targetDocumentId !== document.id ||
        store.cells[command.cell.id]
      )
        return invalid('Invalid document Frame creation');
      const path = documentPathFor(
        document,
        parentWorkspacePath(owner.path) ?? '',
        takenPaths(),
      );
      candidate.set(document.id, { file: clone(document), path });
      candidate.set(command.ownerFrameId, {
        path: owner.path,
        file: {
          ...clone(owner.file),
          frame: {
            ...owner.file.frame,
            children: [...owner.file.frame.children, command.cell.id],
          },
          cells: {
            ...owner.file.cells,
            [command.cell.id]: clone(command.cell),
          },
        },
      });
      return { candidate };
    }
    if (command.type === 'file' || command.type === 'create-file') {
      if (!isWorkspaceFile(command.file))
        return invalid('Invalid workspace file', workspaceFileId(command.file));
      const fileId = workspaceFileId(command.file);
      if (command.type === 'create-file' && files.has(fileId))
        return invalid(`File already exists: ${fileId}`, fileId);
      const existing = files.get(fileId);
      // A file's kind is part of its identity: a document write can never
      // land on a canvas path (or vice versa).
      if (existing && existing.file.format !== command.file.format)
        return invalid('File kind cannot change', fileId);
      const taken = takenPaths(fileId);
      let path =
        command.type === 'create-file' && command.path
          ? command.path
          : (existing?.path ?? workspacePathFor(command.file, '', taken));
      // An explicit path that already belongs to another file must not be
      // reused. Sharing it makes the host reject the create, marks the new
      // file conflicted, and drops it on the next reload.
      if (command.type === 'create-file' && taken.has(path)) {
        const dir = parentWorkspacePath(path) ?? '';
        path = workspacePathFor(command.file, dir, taken);
      }
      candidate.set(fileId, { file: clone(command.file), path });
      return { candidate };
    }
    if (command.type === 'move-file') {
      const id = fileRef(command);
      const entry = id ? files.get(id) : undefined;
      if (!entry || !id) return invalid(`Unknown file: ${id ?? ''}`, id);
      if (entry.path === command.toPath) return { candidate };
      if (takenPaths(id).has(command.toPath))
        return invalid(`Path is occupied: ${command.toPath}`, id);
      candidate.set(id, {
        file: clone(entry.file),
        path: command.toPath,
      });
      return { candidate };
    }
    if (command.type === 'rename-canvas') {
      const entry = files.get(command.fileId);
      const title = command.title.trim();
      if (
        !entry ||
        entry.file.format !== 'verd-frame' ||
        !title ||
        /[/\\]/.test(title)
      )
        return invalid('Invalid canvas name');
      const dir = parentWorkspacePath(entry.path);
      const path = (dir ? dir + '/' : '') + title + CANVAS_FILE_SUFFIX;
      if (path !== entry.path && takenPaths(command.fileId).has(path))
        return invalid('Path is occupied');
      candidate.set(command.fileId, {
        file: {
          ...clone(entry.file),
          frame: { ...clone(entry.file.frame), name: title },
        },
        path,
      });
      return { candidate };
    }
    if (command.type === 'rename-document') {
      const entry = files.get(command.fileId);
      if (!entry)
        return invalid(`Unknown file: ${command.fileId}`, command.fileId);
      if (entry.file.format !== 'verd-document')
        return invalid(`Not a document: ${command.fileId}`, command.fileId);
      const title = command.title.trim();
      if (!title) return invalid('Document title is empty', command.fileId);
      const dir = parentWorkspacePath(entry.path) ?? '';
      const path = dir
        ? `${dir}/${title}${DOCUMENT_FILE_SUFFIX}`
        : `${title}${DOCUMENT_FILE_SUFFIX}`;
      if (path !== entry.path && takenPaths(command.fileId).has(path))
        return invalid(`Path is occupied: ${path}`, command.fileId);
      candidate.set(command.fileId, {
        file: renameDocumentFile(clone(entry.file) as DocumentFileV1, title),
        path,
      });
      return { candidate };
    }
    if (command.type === 'trash-file') {
      const id = fileRef(command);
      if (!id || !files.has(id))
        return invalid(`Unknown file: ${id ?? ''}`, id);
      candidate.delete(id);
      return { candidate };
    }
    if (command.type === 'duplicate-file') {
      const id = fileRef(command);
      const entry = id ? files.get(id) : undefined;
      if (!entry || !id) return invalid(`Unknown file: ${id ?? ''}`, id);
      const dir = command.dir ?? parentWorkspacePath(entry.path) ?? '';
      const taken = takenPaths();
      const originals = [...files.values()].map((item) => item.file);
      const claimed = new Set(
        originals.flatMap((file) =>
          file.format === 'verd-frame'
            ? [file.frame.id, ...Object.keys(file.cells)]
            : [file.id],
        ),
      );
      const { files: clones } = remapWorkspaceFiles(
        workspaceFileClosure(originals, id),
        (value) => claimed.has(value),
        createId,
        { rootId: id },
        registry,
      );
      clones.forEach((file) => {
        const path =
          file.format === 'verd-document'
            ? documentPathFor(file, dir, taken)
            : canvasPathFor(file, dir, taken);
        taken.add(path);
        candidate.set(workspaceFileId(file), { file, path });
      });
      return { candidate };
    }
    if (command.type === 'duplicate-reference') {
      const owner = files.get(command.ownerFrameId);
      if (!owner || owner.file.format !== 'verd-frame')
        return invalid(
          `Unknown frame: ${command.ownerFrameId}`,
          command.ownerFrameId,
        );
      const source = owner.file.cells[command.refId];
      if (!isFrameReferenceCell(source) && !isDocumentCell(source))
        return invalid(
          `Not a frame reference: ${command.refId}`,
          command.ownerFrameId,
        );
      // The reference sits either directly under the root or inside one of
      // the file's groups; the clone joins the same slot after the source.
      const directIndex = owner.file.frame.children.indexOf(command.refId);
      const hostGroup = Object.values(owner.file.cells).find(
        (cell) =>
          cell.cellType === 'group' && cell.members.includes(command.refId),
      );
      if (directIndex < 0 && !hostGroup)
        return invalid(
          `Reference is not owned by this frame: ${command.refId}`,
          command.ownerFrameId,
        );
      const targetId = isFrameReferenceCell(source)
        ? source.data.targetFrameId
        : source.data.targetDocumentId;
      if (!files.has(targetId))
        return invalid(
          `Unresolved reference target: ${targetId}`,
          command.ownerFrameId,
        );
      const dir = parentWorkspacePath(owner.path) ?? '';
      const taken = takenPaths();
      const originals = [...files.values()].map((item) => item.file);
      const claimed = new Set(
        originals.flatMap((file) =>
          file.format === 'verd-frame'
            ? [file.frame.id, ...Object.keys(file.cells)]
            : [file.id],
        ),
      );
      const { files: clones, idMap } = remapWorkspaceFiles(
        workspaceFileClosure(originals, targetId),
        (id) => claimed.has(id),
        createId,
        {
          rootId: targetId,
        },
        registry,
      );
      const rootId = idMap.get(targetId)!;
      clones.forEach((file) => {
        const path =
          file.format === 'verd-document'
            ? documentPathFor(file, dir, taken)
            : canvasPathFor(file, dir, taken);
        taken.add(path);
        candidate.set(workspaceFileId(file), { file: clone(file), path });
      });
      const duplicate = {
        ...clone(source),
        id: createId(),
        geometry: {
          ...source.geometry,
          x: source.geometry.x + 24,
          y: source.geometry.y + 24,
        },
        data: isFrameReferenceCell(source)
          ? { ...clone(source.data), targetFrameId: rootId }
          : { ...clone(source.data), targetDocumentId: rootId },
      } as FrameReferenceCell | DocumentReferenceCell | DocumentFrameCell;
      const file = clone(owner.file);
      if (directIndex >= 0) {
        file.frame = {
          ...file.frame,
          children: [
            ...file.frame.children.slice(0, directIndex + 1),
            duplicate.id,
            ...file.frame.children.slice(directIndex + 1),
          ],
        };
      } else {
        const group = file.cells[hostGroup!.id];
        if (group?.cellType === 'group') {
          const at = group.members.indexOf(command.refId);
          file.cells[group.id] = {
            ...group,
            members: [
              ...group.members.slice(0, at + 1),
              duplicate.id,
              ...group.members.slice(at + 1),
            ],
          };
        }
      }
      file.cells[duplicate.id] = duplicate;
      candidate.set(command.ownerFrameId, { file, path: owner.path });
      return { candidate };
    }
    if (command.type === 'import-files') {
      if (!command.files.length) return invalid('Nothing to import');
      const claimed = new Set<CellId>();
      files.forEach((entry) => {
        claimed.add(workspaceFileId(entry.file));
        if (entry.file.format === 'verd-frame')
          Object.keys(entry.file.cells).forEach((id) => claimed.add(id));
      });
      failedFiles.forEach((failure) => {
        if (failure.fileId) claimed.add(failure.fileId);
      });
      let imported: WorkspaceFile[];
      try {
        imported = remapWorkspaceFiles(
          command.files,
          (id) => claimed.has(id),
          createId,
          undefined,
          registry,
        ).files;
      } catch (error) {
        return invalid(error instanceof Error ? error.message : String(error));
      }
      const taken = takenPaths();
      imported.forEach((file) => {
        const path =
          file.format === 'verd-document'
            ? documentPathFor(file, command.dir ?? '', taken)
            : canvasPathFor(file, command.dir ?? '', taken);
        taken.add(path);
        candidate.set(workspaceFileId(file), { file: clone(file), path });
      });
      return { candidate };
    }
    if (command.type === 'edit-file' || command.type === 'edit-files') {
      const edits =
        command.type === 'edit-file'
          ? [
              {
                sourceFileId: command.sourceFileId,
                store: command.store,
              },
            ]
          : command.edits;
      if (!edits.length) return invalid('Nothing to edit');
      const existing = new Map<CellId, FrameFileV2>();
      files.forEach((entry, id) => {
        if (entry.file.format === 'verd-frame') existing.set(id, entry.file);
      });
      const allowed = new Set(edits.map((edit) => edit.sourceFileId));
      for (const edit of edits) {
        const sourceEntry = files.get(edit.sourceFileId);
        if (!sourceEntry || sourceEntry.file.format !== 'verd-frame')
          return invalid(
            `Unknown frame: ${edit.sourceFileId}`,
            edit.sourceFileId,
          );
        let partitioned: ReturnType<typeof partitionCellStore>;
        try {
          partitioned = partitionCellStore(edit.store, {
            existing,
          });
        } catch (error) {
          return invalid(
            error instanceof Error ? error.message : String(error),
            edit.sourceFileId,
          );
        }
        if (
          !partitioned.files.some((file) => file.frame.id === edit.sourceFileId)
        )
          return invalid('Source file was not preserved', edit.sourceFileId);
        const dir = parentWorkspacePath(sourceEntry.path) ?? '';
        const taken = takenPaths();
        candidate.forEach((snap) => taken.add(snap.path));
        for (const file of partitioned.files) {
          const previous = existing.get(file.frame.id);
          if (!previous) {
            const path = canvasPathFor(file, dir, taken);
            taken.add(path);
            candidate.set(file.frame.id, { file: clone(file), path });
            continue;
          }
          if (allowed.has(file.frame.id)) {
            const path = files.get(file.frame.id)?.path;
            if (!path)
              return invalid(`Unknown frame: ${file.frame.id}`, file.frame.id);
            candidate.set(file.frame.id, { file: clone(file), path });
            continue;
          }
          if (!sameFrameFile(previous, file))
            return invalid(
              'Edit changed a file outside its scope',
              file.frame.id,
            );
        }
      }
      for (const [id, entry] of files) {
        if (entry.file.format !== 'verd-frame' || allowed.has(id)) continue;
        const next = candidate.get(id);
        if (
          !next ||
          !sameFrameFile(entry.file as FrameFileV2, next.file as FrameFileV2)
        )
          return invalid('Edit changed a file outside its scope', id);
      }
      return { candidate };
    }
    if (command.type === 'store') {
      /**
       * Canvas stores only replace the canvas subset: documents never
       * appear in a CellStore and must not be removed by canvas edits.
       * Every resulting diagram remains an independent source file.
       */
      const existing = new Map<CellId, FrameFileV2>();
      files.forEach((entry, id) => {
        if (entry.file.format === 'verd-frame') existing.set(id, entry.file);
      });
      const partitioned = partitionCellStore(command.store, { existing });
      const taken = takenPaths();
      const seen = new Set<CellId>();
      partitioned.files.forEach((file) => {
        const id = file.frame.id;
        seen.add(id);
        const existing = files.get(id);
        const path =
          existing?.path ??
          canvasPathFor(file, command.defaultDir ?? '', taken);
        taken.add(path);
        candidate.set(id, { file: clone(file), path });
      });
      files.forEach((entry, id) => {
        if (entry.file.format === 'verd-frame' && !seen.has(id))
          candidate.delete(id);
      });
      return { candidate };
    }
    return invalid(
      `Unsupported command: ${(command as { type: string }).type}`,
    );
  };

  const runCommand = async (
    command: WorkspaceCommand,
    recordHistory: boolean,
  ): Promise<CommandResult> => {
    if (
      (command.type === 'batch' || command.type === 'import-files') &&
      command.resources !== undefined
    )
      return importBatch(command, recordHistory);
    if (
      command.type === 'organize-entries' ||
      command.type === 'move-directory'
    )
      return organizeEntries(
        command.type === 'move-directory'
          ? {
              type: 'organize-entries',
              moves: [{ from: command.path, to: command.toPath }],
              label: command.label,
            }
          : command,
        recordHistory,
      );
    if (
      command.type === 'restore-file' ||
      command.type === 'trash-directory' ||
      command.type === 'purge-trash'
    )
      return storageCommand(command, recordHistory);
    // A dirty file must reach disk before the host moves its bytes to trash.
    // Otherwise a queued write would target the now-absent original path.
    if (command.type === 'trash-file') {
      mutationsPaused = true;
      suspendSync += 1;
      emit();
      try {
        if (!(await flush()))
          return invalid('Save pending changes before deleting the file');
      } finally {
        mutationsPaused = false;
        suspendSync -= 1;
        emit();
        drainSync();
      }
    }
    const planned = candidateFor(command);
    if ('diagnostics' in planned) return planned;
    const repairPaths = new Set(
      command.type === 'batch' ? (command.repairPaths ?? []) : [],
    );
    const plan = planDiff(planned.candidate, repairPaths);
    if (!plan.affected.size) return { ok: true, diagnostics: [] };
    for (const [id, item] of plan.candidate) {
      const previous = files.get(id)?.file.properties;
      if (previous && !item.file.properties)
        item.file = { ...item.file, properties: clone(previous) };
    }
    const structural = validateCandidate(plan, repairPaths);
    if (structural.length) return { ok: false, diagnostics: structural };
    const meta =
      command.type === 'file' && command.history
        ? {
            ...command.history,
            primaryFileId: workspaceFileId(command.file),
          }
        : command.type === 'edit-file' && command.history
          ? { ...command.history, primaryFileId: command.sourceFileId }
          : command.type === 'edit-file'
            ? { primaryFileId: command.sourceFileId }
            : undefined;
    install(plan, command.label, recordHistory, meta);
    return { ok: true, diagnostics: [] };
  };

  /** Never feed an atomic import through the per-file rejection recovery queue. */
  const confirmImport = (): Promise<CommandResult> => {
    if (importFlight) return importFlight;
    const run = async (): Promise<CommandResult> => {
      const operation = importPending;
      if (!operation) return { ok: true, diagnostics: [] };
      suspendSync++;
      setStatus('saving');
      try {
        const receipt = await commitFiles(operation.request);
        if (receipt.outcome !== 'applied') {
          if (receipt.reason !== 'io-error') importPending = null;
          setStatus('error');
          return invalid('Import failed: ' + receipt.reason);
        }
        install(operation.plan, operation.label, operation.recordHistory);
        // Resource digests are separate, so only native content settles here.
        settleReceipt(operation.request, receipt);
        importPending = null;
        setStatus('saved');
        return { ok: true, diagnostics: [] };
      } catch (cause) {
        // The host may have applied before the transport failed. Retain the
        // entire immutable request and original id for the Retry save action.
        setStatus('error');
        return invalid(
          'Import result is unconfirmed; retry saving: ' + String(cause),
        );
      } finally {
        suspendSync--;
        mutationsPaused = importPending !== null;
        emit();
      }
    };
    importFlight = run().finally(() => {
      importFlight = null;
      drainSync();
    });
    return importFlight;
  };

  const importBatch = async (
    command: Extract<WorkspaceCommand, { type: 'batch' | 'import-files' }>,
    recordHistory: boolean,
  ): Promise<CommandResult> => {
    const captured = {
      ...command,
      files: clone(command.files),
      resources: command.resources!.map((resource) => ({
        assetId: resource.assetId,
        content: new Uint8Array(resource.content),
      })),
    } as typeof command & { resources: WorkspaceResource[] };
    mutationsPaused = true;
    suspendSync++;
    emit();
    try {
      if (!(await flush()))
        return invalid('Save pending changes before importing');
      await validateWorkspaceResources(captured.resources);
      if (
        captured.files.length + captured.resources.length >
          WORKSPACE_PACKAGE_MAX_ENTRIES ||
        new TextEncoder().encode(JSON.stringify(captured.files)).length +
          captured.resources.reduce(
            (sum, resource) => sum + resource.content.length,
            0,
          ) >
          WORKSPACE_PACKAGE_MAX_BYTES
      )
        return invalid('Package exceeds limits');
      const planned = candidateFor(captured);
      if ('diagnostics' in planned) return planned;
      const repairPaths = new Set(
        captured.type === 'batch' ? (captured.repairPaths ?? []) : [],
      );
      const plan = planDiff(planned.candidate, repairPaths);
      const structural = validateCandidate(plan, repairPaths);
      if (structural.length) return { ok: false, diagnostics: structural };
      const writes = plan.writes.map((item) => item.op);
      const resourceWrites: FileWriteOp[] = [];
      for (const resource of captured.resources) {
        const path = workspaceAssetPath(resource.assetId);
        const existing = resourceMetaAt(path);
        let expectedVersion: FileVersion | null = null;
        if (existing) {
          const raw = await readRawFile(path);
          if (
            raw.content.length !== resource.content.length ||
            raw.content.some((byte, index) => byte !== resource.content[index])
          )
            return invalid(
              'Existing resource content differs: ' + resource.assetId,
            );
          expectedVersion = raw.version;
        }
        resourceWrites.push({
          path: normalizeResourceKey(path),
          content: resource.content,
          expectedVersion,
        });
      }
      importPending = {
        request: {
          transactionId: createId() + '-import',
          writes,
          resourceWrites,
          moves: plan.moves.map((item) => item.op),
          trash: plan.trashes.map((item) => item.op),
        },
        plan,
        label: captured.label,
        recordHistory,
      };
      return await confirmImport();
    } catch (cause) {
      return invalid('Import failed: ' + String(cause));
    } finally {
      suspendSync--;
      mutationsPaused = importPending !== null;
      emit();
      drainSync();
    }
  };

  const within = (path: string, root: string) =>
    path === root || path.startsWith(`${root}/`);
  const storageKey = (command: WorkspaceCommand | StorageCommand) =>
    JSON.stringify(command);

  /** Keep the exact request after an unknown outcome; only replay may proceed. */
  const storageCommand = async (
    command: StorageCommand,
    recordHistory: boolean,
    replay?: HistoryEntry,
  ): Promise<CommandResult> => {
    const key = storageKey(command);
    if (storageRetry && storageRetry.key !== key)
      return invalid(
        'Retry the previous trash operation before making changes',
      );
    mutationsPaused = true;
    suspendSync += 1;
    emit();
    try {
      if (!storageRetry) {
        if (!(await flush()))
          return invalid(
            'Save pending changes and resolve conflicts before continuing',
          );
        let paths: string[];
        const request: CommitRequest = {
          transactionId: `${createId()}-trash-operation`,
        };
        if (
          command.type === 'trash-directory' ||
          command.type === 'trash-path'
        ) {
          const path = normalizeWorkspacePath(command.path);
          const source = entries.find((entry) => entry.path === path);
          if (
            !source ||
            (command.type === 'trash-directory' && source.kind !== 'directory')
          )
            return invalid('Directory does not exist');
          paths = [path];
          request.trash = [
            {
              path,
              expectedVersion:
                source.kind === 'file'
                  ? (source.version ?? (await readRawFile(path)).version)
                  : undefined,
            },
          ];
        } else if (command.type === 'restore-file') {
          normalizeTrashEntryId(command.entryId);
          const meta = trash.find((entry) => entry.entryId === command.entryId);
          if (!meta) return invalid('Trash entry does not exist');
          paths = [normalizeWorkspacePath(command.toPath ?? meta.originalPath)];
          if (entries.some((entry) => within(entry.path, paths[0])))
            return invalid('Restore destination is occupied');
          request.restore = [
            { entryId: command.entryId, toPath: command.toPath },
          ];
        } else {
          request.purge = [
            ...new Set(command.entryIds.map(normalizeTrashEntryId)),
          ];
          paths = trash
            .filter((entry) => request.purge!.includes(entry.entryId))
            .map((entry) => entry.originalPath);
        }
        const before: HistoryEntry['before'] = new Map();
        files.forEach((entry, id) => {
          if (paths.some((path) => within(entry.path, path)))
            before.set(id, { file: clone(entry.file), path: entry.path });
        });
        const direction =
          replay &&
          (command.type === 'restore-file') ===
            (replay.subtree!.action === 'trash')
            ? 'undo'
            : 'redo';
        storageRetry = {
          key,
          request,
          paths,
          before,
          resume: () =>
            replay
              ? replayHistory(direction)
              : storageCommand(command, recordHistory),
        };
        invalidateSnapshot();
      }
      const operation = storageRetry;
      const receipt = await commitFiles(operation.request);
      if (receipt.outcome !== 'applied') {
        if (receipt.reason !== 'io-error') storageRetry = null;
        else setStatus('error');
        return invalid(
          `Trash operation rejected: ${receipt.reason ?? 'unknown'}`,
        );
      }
      const snapshot = await host.readSnapshot(handle);
      const loaded = await readWorkspaceFiles(
        host,
        handle,
        snapshot,
        registry,
        files,
        failedFiles,
      );
      const previousLoadDiagnostics = new Set(loadDiagnostics);
      diagnostics = [
        ...diagnostics.filter((issue) => !previousLoadDiagnostics.has(issue)),
        ...loaded.diagnostics,
      ];
      loadDiagnostics = loaded.diagnostics;
      failedFiles = loaded.failedFiles;
      if (command.type === 'purge-trash') {
        const affectedIds = new Set<CellId>(
          operation.request.purge!.flatMap((entryId) => [
            ...(trashIdentities.get(entryId) ?? []),
          ]),
        );
        const touches = (entry: HistoryEntry) =>
          [...entry.before.keys(), ...entry.after.keys()].some((id) =>
            affectedIds.has(id),
          ) ||
          (entry.subtree &&
            operation.request.purge!.includes(entry.subtree.entryId)) ||
          !!entry.storage?.undo.restores?.some((r) =>
            operation.request.purge!.includes(r.entryId),
          );
        for (const stack of [undoStack, redoStack])
          for (let at = stack.length - 1; at >= 0; at -= 1)
            if (touches(stack[at])) stack.splice(at, 1);
        operation.request.purge!.forEach((entryId) =>
          trashIdentities.delete(entryId),
        );
      } else {
        const path = operation.paths[0];
        const recovered = [...loaded.files.values()].filter((entry) =>
          within(entry.path, path),
        );
        // Host commit succeeded: install its subtree without classifying our own
        // removals as external changes (which would invalidate undo history).
        files.forEach((entry, id) => {
          if (within(entry.path, path)) files.delete(id);
        });
        const after: HistoryEntry['after'] = new Map();
        operation.before.forEach((_, id) => after.set(id, undefined));
        for (const payload of recovered) {
          const file = payload.file!;
          const id = workspaceFileId(file);
          if (files.has(id)) {
            diagnostics.push({
              path: payload.path,
              frameId: id,
              message: 'Restored file identity already exists',
            });
            continue;
          }
          files.set(id, {
            file: clone(file),
            path: payload.path,
            version: payload.version,
            dirty: false,
          });
          filePersistence.adoptDisk(id);
          after.set(id, { file: clone(file), path: payload.path });
          if (!operation.before.has(id)) operation.before.set(id, undefined);
        }
        const entryId =
          command.type === 'trash-directory' || command.type === 'trash-path'
            ? receipt.trashEntries?.find((entry) => entry.path === path)
                ?.entryId
            : command.entryId;
        if (!entryId)
          throw new Error('Trash receipt is missing its entry identifier');
        trashIdentities.set(
          entryId,
          new Set([...operation.before.keys(), ...after.keys()]),
        );
        if (replay) replay.subtree!.entryId = entryId;
        if (recordHistory) {
          undoStack.push({
            label: command.label,
            primaryFileId:
              recovered.length === 1 &&
              snapshot.entries.find((entry) => entry.path === path)?.kind ===
                'file'
                ? workspaceFileId(recovered[0].file!)
                : undefined,
            before: operation.before,
            after,
            subtree: {
              action: command.type === 'restore-file' ? 'restore' : 'trash',
              path,
              entryId,
            },
          });
          redoStack.length = 0;
        }
        rebuildDerived();
      }
      if (JSON.stringify(agent) !== JSON.stringify(snapshot.agent)) {
        agent = snapshot.agent ? clone(snapshot.agent) : undefined;
      }
      entries = snapshot.entries;
      context = snapshot.context;
      resources = [...(snapshot.resources ?? [])];
      trash = snapshot.trash;
      storageRetry = null;
      if (hasPending()) schedule();
      else setStatus('saved');
      emit();
      return { ok: true, diagnostics: [] };
    } catch (error) {
      if (storageRetry) setStatus('error');
      return invalid(error instanceof Error ? error.message : String(error));
    } finally {
      mutationsPaused = false;
      suspendSync -= 1;
      emit();
      drainSync();
    }
  };

  const organizeEntries = async (
    command: Extract<WorkspaceCommand, { type: 'organize-entries' }>,
    recordHistory: boolean,
    replay?: { entry: HistoryEntry; direction: 'undo' | 'redo' },
  ): Promise<CommandResult> => {
    mutationsPaused = true;
    suspendSync++;
    emit();
    try {
      if (!storageRetry) {
        if (!(await flush()))
          return invalid('Save pending changes and resolve conflicts first');
        const moves = command.moves ?? [];
        const roots = topLevelPaths(
          moves.map((m) => normalizeWorkspacePath(m.from)),
        );
        const selectedMoves = moves.filter(
          (m) => roots.includes(m.from) && m.from !== m.to,
        );
        const trashPaths = topLevelPaths(
          (command.trashPaths ?? []).map(normalizeWorkspacePath),
        );
        const deferredVersions = new Map<string, FileVersion>();
        for (const path of new Set([
          ...selectedMoves.map((move) => move.from),
          ...trashPaths,
        ])) {
          const entry = entries.find((entry) => entry.path === path);
          if (entry?.kind === 'file' && !entry.version)
            deferredVersions.set(path, (await readRawFile(path)).version);
        }
        const source = (path: string) => {
          const item = entries.find((e) => e.path === path);
          if (!item) throw new Error('Source is missing: ' + path);
          const current = [...files.values()].find((e) => e.path === path);
          return {
            ...item,
            version:
              current?.version ??
              failedFiles.get(path)?.version ??
              item.version ??
              deferredVersions.get(path),
          };
        };
        for (const move of selectedMoves) {
          normalizeWorkspacePath(move.to);
          if (move.to.startsWith(move.from + '/'))
            throw new Error('Cannot move a directory into itself');
          source(move.from);
        }
        const request: CommitRequest = {
          transactionId: createId() + '-organize',
          moves: selectedMoves.map((m) => ({
            ...m,
            expectedVersion: source(m.from).version,
          })),
          trash: trashPaths.map((path) => ({
            path,
            expectedVersion: source(path).version,
          })),
          restore: command.restores,
        };
        const value: Record<string, unknown> = remapOrganization(
          config.value,
          selectedMoves,
        );
        if (command.navigation !== undefined)
          value['navigation'] = remapOrganization(
            { navigation: command.navigation },
            selectedMoves,
          )['navigation'];
        if (replay && command.navigation !== undefined) {
          const restored = readOrganization(value);
          value['navigation'] = {
            ...readOrganization(config.value),
            order: restored.order,
          };
        }
        request.config = { value, expectedVersion: config.version };
        storageRetry = {
          key: storageKey(command),
          request,
          paths: [...roots, ...trashPaths],
          before: new Map(
            [...files]
              .filter(([, entry]) =>
                [...roots, ...trashPaths].some((path) =>
                  within(entry.path, path),
                ),
              )
              .map(([id, entry]) => [
                id,
                { file: clone(entry.file), path: entry.path },
              ]),
          ),
          resume: () => organizeEntries(command, recordHistory, replay),
        };
      }
      const operation = storageRetry;
      const beforeNavigation = readOrganization(config.value);
      const receipt = await commitFiles(operation.request);
      if (receipt.outcome !== 'applied') {
        if (receipt.reason !== 'io-error') storageRetry = null;
        else setStatus('error');
        return invalid('Organization failed: ' + receipt.reason);
      }
      for (const item of receipt.trashEntries ?? [])
        trashIdentities.set(
          item.entryId,
          new Set(
            [...operation.before]
              .filter(([, entry]) => entry && within(entry.path, item.path))
              .map(([id]) => id),
          ),
        );
      const snapshot = await host.readSnapshot(handle);
      const loaded = await readWorkspaceFiles(
        host,
        handle,
        snapshot,
        registry,
        files,
        failedFiles,
      );
      const inverse: Extract<WorkspaceCommand, { type: 'organize-entries' }> = {
        type: 'organize-entries',
        moves: operation.request.moves?.map((m) => ({
          from: m.to,
          to: m.from,
        })),
        restores: receipt.trashEntries?.map((t) => ({
          entryId: t.entryId,
          toPath: t.path,
        })),
        trashPaths: operation.request.restore
          ?.map((r) => r.toPath!)
          .filter(Boolean),
        navigation: beforeNavigation,
      };
      if (replay)
        replay.entry.storage![replay.direction === 'undo' ? 'redo' : 'undo'] =
          inverse;
      else if (
        recordHistory &&
        (operation.request.moves?.length ?? 0) +
          (operation.request.trash?.length ?? 0) +
          (operation.request.restore?.length ?? 0) >
          0
      ) {
        undoStack.push({
          before: operation.before,
          after: new Map(),
          label: command.label ?? 'Organize files',
          storage: { undo: inverse, redo: command },
        });
        redoStack.length = 0;
      }
      const previousFiles = new Map(files);
      files.clear();
      for (const payload of loaded.files.values()) {
        const file = payload.file!;
        const id = workspaceFileId(file);
        const previous = previousFiles.get(id);
        if (
          previous?.path === payload.path &&
          previous?.version === payload.version
        )
          files.set(id, previous);
        else {
          files.set(id, {
            file: clone(file),
            path: payload.path,
            version: payload.version,
            dirty: false,
          });
          filePersistence.adoptDisk(id);
        }
      }
      failedFiles = loaded.failedFiles;
      entries = snapshot.entries;
      context = snapshot.context;
      resources = [...(snapshot.resources ?? [])];
      trash = snapshot.trash;
      config = clone(snapshot.config);
      session.expandedDirs = session.expandedDirs.map((path) => {
        const move = operation.request.moves?.find((m) => within(path, m.from));
        return move ? move.to + path.slice(move.from.length) : path;
      });
      session = pruneWorkspaceTabs(session, (id) => files.has(id));
      pending.session = clone(session);
      storageRetry = null;
      rebuildDerived();
      schedule();
      emit();
      return { ok: true, diagnostics: [] };
    } catch (error) {
      if (storageRetry) setStatus('error');
      return invalid(error instanceof Error ? error.message : String(error));
    } finally {
      mutationsPaused = false;
      suspendSync--;
      emit();
      drainSync();
    }
  };

  /**
   * Host hints are deferred while the session has in-flight commits, pending
   * content ops or an active restore — merging mid-commit would mark our own writes
   * as phantom conflicts or race a restore's file registration.
   * Navigation alone does not change file versions and must not delay recovery.
   */
  const requestSync = () => {
    if (disposed) return;
    if (
      suspendSync > 0 ||
      storageRetry ||
      importPending ||
      inflight ||
      hasPendingContent()
    ) {
      syncQueued = true;
      return;
    }
    void syncFromHost().catch(() => {});
  };

  const drainSync = () => {
    if (
      disposed ||
      !syncQueued ||
      suspendSync > 0 ||
      importPending ||
      storageRetry ||
      inflight ||
      hasPendingContent()
    )
      return;
    syncQueued = false;
    void syncFromHost().catch(() => {});
  };

  /**
   * Merges an external snapshot: clean files adopt disk state (including
   * moves and new files), dirty files keep local state and turn conflicted
   * when their base version changed, externally-removed dirty files stay
   * conflicted, and the trash listing refreshes. Local commits feed back
   * through the same path and merge as no-ops.
   */
  const syncFromHost = async () => {
    const readId = ++syncReadId;
    const baseFiles = new Map(files);
    const baseConfig = config;
    const snapshot = await host.readSnapshot(handle);
    if (disposed || readId !== syncReadId) return;
    // A read can start while idle and finish after an edit or commit. Its
    // versions then describe our own earlier state, not an external change.
    // Re-read once the local queue drains instead of rolling content back or
    // flagging a phantom conflict. Entries are replaced on every mutation.
    if (
      suspendSync > 0 ||
      importPending ||
      storageRetry ||
      inflight ||
      config !== baseConfig ||
      files.size !== baseFiles.size ||
      [...files].some(([id, entry]) => baseFiles.get(id) !== entry)
    ) {
      syncQueued = true;
      drainSync();
      return;
    }
    const loaded = await readWorkspaceFiles(
      host,
      handle,
      snapshot,
      registry,
      files,
      failedFiles,
    );
    // Raw legacy reads also await I/O; do not install a stale result over edits.
    if (disposed || readId !== syncReadId) return;
    if (
      inflight ||
      suspendSync > 0 ||
      config !== baseConfig ||
      files.size !== baseFiles.size ||
      [...files].some(([id, entry]) => baseFiles.get(id) !== entry)
    ) {
      syncQueued = true;
      drainSync();
      return;
    }
    const diskById = loaded.files;
    let changed =
      JSON.stringify([...failedFiles]) !==
        JSON.stringify([...loaded.failedFiles]) ||
      JSON.stringify(loadDiagnostics) !== JSON.stringify(loaded.diagnostics);
    failedFiles = loaded.failedFiles;
    /**
     * Clean files that adopted external content (or vanished) make every
     * history entry touching them stale — replaying an old snapshot would
     * silently overwrite the new disk truth.
     */
    const externallyChanged = new Set<CellId>();
    files.forEach((entry, id) => {
      const disk = diskById.get(id);
      diskById.delete(id);
      // Rejected requests can leave no queued write while the local content
      // still differs from disk. Metadata-only sync must not discard it.
      const hasLocalChanges = entry.dirty || filePersistence.hasError(id);
      if (!disk) {
        if (!hasLocalChanges) {
          files.delete(id);
          externallyChanged.add(id);
        } else
          files.set(id, {
            ...entry,
            conflicted: true,
            diagnostic: failedFiles.has(entry.path)
              ? 'External file is invalid'
              : 'Removed externally',
          });
        changed = true;
        return;
      }
      if (!hasLocalChanges) {
        if (
          !sameFile(entry.file, disk.file) ||
          entry.path !== disk.path ||
          entry.version !== disk.version
        ) {
          if (!sameFile(entry.file, disk.file)) externallyChanged.add(id);
          files.set(id, {
            file: clone(disk.file),
            path: disk.path,
            version: disk.version,
            dirty: false,
          });
          filePersistence.adoptDisk(id);
          changed = true;
        }
        return;
      }
      if (entry.version !== disk.version && !entry.conflicted) {
        files.set(id, {
          ...entry,
          conflicted: true,
          diagnostic: 'Modified externally',
        });
        changed = true;
      }
    });
    diskById.forEach((disk, id) => {
      files.set(id, {
        file: clone(disk.file),
        path: disk.path,
        version: disk.version,
        dirty: false,
      });
      filePersistence.adoptDisk(id);
      changed = true;
    });
    if (externallyChanged.size) {
      const touches = (entry: HistoryEntry) =>
        [...entry.before.keys(), ...entry.after.keys()].some((id) =>
          externallyChanged.has(id),
        );
      for (let at = undoStack.length - 1; at >= 0; at -= 1)
        if (touches(undoStack[at])) undoStack.splice(at, 1);
      redoStack.length = 0;
    }
    changed ||=
      JSON.stringify(entries) !== JSON.stringify(snapshot.entries) ||
      JSON.stringify(resources) !== JSON.stringify(snapshot.resources ?? []) ||
      JSON.stringify(trash) !== JSON.stringify(snapshot.trash);
    if (JSON.stringify(context) !== JSON.stringify(snapshot.context)) {
      context = snapshot.context;
      changed = true;
    }
    if (JSON.stringify(agent) !== JSON.stringify(snapshot.agent)) {
      agent = snapshot.agent ? clone(snapshot.agent) : undefined;
      changed = true;
    }
    entries = snapshot.entries;
    resources = [...(snapshot.resources ?? [])];
    trash = snapshot.trash;
    // Loading errors are replaced on every read; save/conflict diagnostics survive.
    const oldLoadDiagnostics = new Set(loadDiagnostics);
    diagnostics = [
      ...diagnostics.filter((issue) => !oldLoadDiagnostics.has(issue)),
      ...loaded.diagnostics,
    ];
    loadDiagnostics = loaded.diagnostics;
    if (
      !pending.config &&
      JSON.stringify(config) !== JSON.stringify(snapshot.config)
    ) {
      config = clone(snapshot.config);
      changed = true;
    }
    if (changed) {
      rebuildDerived();
      emit();
    }
  };

  /**
   * Replays a history entry's inverse through the ordinary command pipeline —
   * the same validation, the same diff-to-ops, no second history entry.
   */
  const applyInverse = async (
    entry: HistoryEntry,
    direction: 'undo' | 'redo',
  ): Promise<CommandResult> => {
    if (entry.storage)
      return organizeEntries(entry.storage[direction], false, {
        entry,
        direction,
      });
    if (storageRetry && !entry.subtree)
      return invalid(
        'Retry the previous trash operation before replaying history',
      );
    if (entry.subtree) {
      const subtree = entry.subtree;
      const restore = (direction === 'undo') === (subtree.action === 'trash');
      const result = await storageCommand(
        restore
          ? {
              type: 'restore-file',
              entryId: subtree.entryId,
              toPath: subtree.path,
            }
          : { type: 'trash-path', path: subtree.path },
        false,
        entry,
      );
      return result.ok && restore && entry.primaryFileId
        ? { ...result, restored: { fileId: entry.primaryFileId } }
        : result;
    }
    // A file waiting on a conflict decision must not be rewritten by
    // replaying history around it.
    const blocked = [...entry.before.keys(), ...entry.after.keys()].find(
      (id) => files.get(id)?.conflicted,
    );
    if (blocked)
      return invalid(
        `Resolve the conflict before replaying history on this file`,
        blocked,
      );
    const source = direction === 'undo' ? entry.before : entry.after;
    const candidate = new Map<CellId, FileSnapshot>();
    files.forEach((entry_, id) =>
      candidate.set(id, { file: entry_.file, path: entry_.path }),
    );
    source.forEach((value, id) => {
      if (value === undefined) candidate.delete(id);
      else candidate.set(id, { file: clone(value.file), path: value.path });
    });
    const plan = planDiff(candidate);
    if (!plan.affected.size)
      return {
        ok: true,
        diagnostics: [],
        restored: entry.primaryFileId
          ? { fileId: entry.primaryFileId }
          : undefined,
      };
    const structural = validateCandidate(plan);
    if (structural.length) return { ok: false, diagnostics: structural };
    install(plan, entry.label, false);
    const selection =
      direction === 'undo' ? entry.selection?.before : entry.selection?.after;
    return {
      ok: true,
      diagnostics: [],
      restored: entry.primaryFileId
        ? {
            fileId: entry.primaryFileId,
            origin: entry.origin,
            selection:
              entry.selection && entry.selection.fileId === entry.primaryFileId
                ? selection
                : undefined,
          }
        : undefined,
    };
  };

  const replayHistory = async (
    direction: 'undo' | 'redo',
  ): Promise<CommandResult> => {
    if (workspaceReadonly || mutationsPaused || frozen)
      return invalid('Workspace is unavailable');
    const source = direction === 'undo' ? undoStack : redoStack;
    const destination = direction === 'undo' ? redoStack : undoStack;
    const entry = source.pop();
    if (!entry) return { ok: true, diagnostics: [] };
    invalidateSnapshot();
    const result = await applyInverse(entry, direction);
    if (result.ok) destination.push(entry);
    else source.push(entry);
    emit();
    return result;
  };

  const unsubscribeHost = host.subscribe(handle, requestSync);

  const runVersionOperation = async <
    T extends WorkspaceGitResult | VersionResult,
  >(
    request: WorkspaceGitRequest | VersionRequest,
    execute: () => Promise<T>,
  ): Promise<T> => {
    const write = !['status', 'log', 'list', 'read'].includes(request.type);
    if (disposed || frozen || (write && workspaceReadonly))
      throw new Error('Workspace is unavailable or read-only');
    if (gitFlight || mutationsPaused || storageRetry || importPending)
      throw new Error('Another workspace operation is in progress');
    gitFlight = true;
    mutationsPaused = true;
    suspendSync++;
    emit();
    const reload = [
      'restore',
      'sync',
      'purge',
      'init',
      'configure',
      'commit',
      'create',
    ].includes(request.type);
    let hostStarted = false;
    try {
      if (!(await flush()))
        throw new Error(
          'Save pending changes and resolve conflicts before using version history',
        );
      hostStarted = true;
      const result = await execute();
      if (request.type === 'purge-plan' && result.plan)
        gitPurgeTargets.set(result.plan.id, {
          ids: new Set([
            ...request.fileIds,
            ...(result.plan.fileIds ?? []),
            ...(request.trashEntryIds ?? []).flatMap((id) => [
              ...(trashIdentities.get(id) ?? []),
            ]),
          ]),
          trash: new Set(request.trashEntryIds ?? []),
        });
      return result;
    } finally {
      try {
        if (reload && hostStarted && !disposed) {
          const snapshot = await host.readSnapshot(handle);
          const loaded = await readWorkspaceFiles(
            host,
            handle,
            snapshot,
            registry,
            files,
            failedFiles,
          );
          const changedIds = new Set<CellId>();
          const purged =
            request.type === 'purge'
              ? gitPurgeTargets.get(request.planId)
              : undefined;
          purged?.ids.forEach((id) => changedIds.add(id));
          for (const [id, entry] of files) {
            const next = loaded.files.get(id);
            if (
              !next ||
              next.version !== entry.version ||
              next.path !== entry.path
            )
              changedIds.add(id);
          }
          files.clear();
          for (const [id, entry] of loaded.files) {
            files.set(id, { ...entry, file: clone(entry.file), dirty: false });
            filePersistence.adoptDisk(id);
          }
          for (const stack of [undoStack, redoStack])
            for (let at = stack.length - 1; at >= 0; at--)
              if (
                (request.type === 'purge' && !purged) ||
                [...stack[at].before.keys(), ...stack[at].after.keys()].some(
                  (id) => changedIds.has(id),
                ) ||
                (stack[at].subtree &&
                  purged?.trash.has(stack[at].subtree!.entryId)) ||
                stack[at].storage?.undo.restores?.some((entry) =>
                  purged?.trash.has(entry.entryId),
                )
              )
                stack.splice(at, 1);
          failedFiles = loaded.failedFiles;
          loadDiagnostics = loaded.diagnostics;
          diagnostics = [...loaded.diagnostics];
          entries = snapshot.entries;
          context = snapshot.context;
          resources = [...(snapshot.resources ?? [])];
          trash = snapshot.trash;
          config = clone(snapshot.config);
          agent = snapshot.agent ? clone(snapshot.agent) : undefined;
          session = pruneWorkspaceTabs(session, (id) => files.has(id));
          pending.session = clone(session);
          rebuildDerived();
        }
      } finally {
        gitFlight = false;
        mutationsPaused = false;
        suspendSync--;
        emit();
        if (pending.session) schedule();
        drainSync();
      }
    }
  };

  const trackVersionOperation = <T>(execute: () => Promise<T>): Promise<T> => {
    const previous = gitOperation;
    const operation = (
      previous ? previous.catch(() => {}) : Promise.resolve()
    ).then(execute);
    gitOperation = operation;
    return operation.finally(() => {
      if (gitOperation === operation) gitOperation = null;
    });
  };
  return {
    versionDiagnostic() {
      return versionDiagnostic;
    },
    versions(request) {
      return trackVersionOperation(() =>
        runVersionOperation(request, () => versionHost(handle, request)),
      ).catch((error) => {
        versionDiagnostic =
          error && typeof error === 'object' && 'diagnostic' in error
            ? String(error.diagnostic)
            : String(error);
        throw error;
      });
    },
    git(request) {
      if (gitOperation)
        return Promise.reject(
          new Error('Another Git operation is in progress'),
        );
      const operation = runVersionOperation(request, async () => {
        if (host.git) return host.git(handle, request);
        if (request.type !== 'status')
          throw new Error('Git is unavailable for this workspace host');
        return {
          status: {
            available: false,
            initialized: false,
            head: null,
            branch: null,
            token: '',
            changes: [],
            canSync: false,
          },
        };
      });
      gitOperation = operation;
      return operation.finally(() => {
        if (gitOperation === operation) gitOperation = null;
      });
    },
    getState() {
      if (cachedSnapshot) return cachedSnapshot;
      // Keep published maps immutable, and retain their identity for navigation
      // and status changes so consumers can memoize work over file contents.
      let canvasCount = 0;
      let documentCount = 0;
      let canvasesChanged = false;
      let documentsChanged = false;
      files.forEach((entry, id) => {
        if (entry.file.format === 'verd-document') {
          documentCount += 1;
          documentsChanged ||= documentEntries.get(id) !== entry;
        } else {
          canvasCount += 1;
          canvasesChanged ||= canvasEntries.get(id) !== entry;
        }
      });
      canvasesChanged ||= canvasCount !== canvasEntries.size;
      documentsChanged ||= documentCount !== documentEntries.size;
      if (canvasesChanged) canvasEntries = new Map();
      if (documentsChanged) documentEntries = new Map();
      if (canvasesChanged || documentsChanged)
        files.forEach((entry, id) => {
          if (entry.file.format === 'verd-document') {
            if (documentsChanged)
              documentEntries.set(
                id,
                entry as WorkspaceFileEntry<DocumentFileV1>,
              );
          } else if (canvasesChanged)
            canvasEntries.set(id, entry as WorkspaceFileEntry<FrameFileV2>);
        });
      cachedSnapshot = {
        filePersistence: filePersistence.snapshot(),
        store,
        failedFiles: new Map(failedFiles),
        files: canvasEntries,
        documents: documentEntries,
        fileIdByPath: fileIdByPath(),
        graph,
        references,
        mutationsPaused: mutationsPaused || storageRetry !== null,
        trashUnconfirmed: storageRetry !== null && !mutationsPaused,
        session: clone(session),
        entries: [...entries],
        resources: [...resources],
        trash: [...trash],
        context: context ? clone(context) : undefined,
        agent: agent ? clone(agent) : undefined,
        config: pending.config
          ? { version: config.version, value: clone(pending.config.value) }
          : clone(config),
        savedConfig: clone(config),
        diagnostics: [...diagnostics],
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        dirty:
          [...files.values()].some((entry) => entry.dirty) ||
          hasPending() ||
          storageRetry !== null ||
          importPending !== null,
        saveStatus,
      };
      return cachedSnapshot;
    },
    apply: (command) => {
      if (workspaceReadonly)
        return Promise.resolve(invalid('Workspace is read-only'));
      if (mutationsPaused)
        return Promise.resolve(invalid('Workspace operation in progress'));
      if (storageRetry && storageRetry.key !== JSON.stringify(command))
        return Promise.resolve(
          invalid('Retry the previous trash operation before making changes'),
        );
      if (frozen) return Promise.resolve(invalid('Workspace is closing'));
      return runCommand(
        command,
        !('recordHistory' in command) || command.recordHistory !== false,
      );
    },
    setReadonly(next) {
      workspaceReadonly = next;
      emit();
    },
    syncFromHost,
    undo: () => replayHistory('undo'),
    redo: () => replayHistory('redo'),
    retryTrashOperation: () => {
      if (workspaceReadonly || mutationsPaused || frozen)
        return Promise.resolve(invalid('Workspace is unavailable'));
      return (
        storageRetry?.resume() ?? Promise.resolve({ ok: true, diagnostics: [] })
      );
    },
    setSessionState(next) {
      session = clone(next);
      pending.session = clone(next);
      schedule();
      emit();
    },
    setWorkspaceConfig(value) {
      if (workspaceReadonly || mutationsPaused || storageRetry || frozen)
        return;
      pending.config = {
        value: clone(value),
        expectedVersion: config.version,
      };
      schedule();
      emit();
    },
    mkdir(path) {
      if (workspaceReadonly || mutationsPaused || frozen || storageRetry)
        return invalid('Workspace is unavailable');
      const normalized = path.replace(/\/+$/, '');
      if (!normalized || entries.some((entry) => entry.path === normalized))
        return invalid(`Path is occupied or invalid: ${normalized}`);
      const folderId = crypto.randomUUID();
      const marker = folderIdentityWrite(normalized, folderId);
      pending.mkdirs.push(normalized);
      pending.writes.set(marker.path, marker);
      entries = [
        ...entries,
        { path: normalized, kind: 'directory', canvas: false, folderId },
      ];
      schedule();
      emit();
      return { ok: true, diagnostics: [] };
    },
    async ensureFolderId(path) {
      const normalized = normalizeWorkspacePath(path);
      const writable = () =>
        !workspaceReadonly &&
        !mutationsPaused &&
        !frozen &&
        !storageRetry &&
        !disposed;
      if (writable() && !(await flush()))
        throw new Error('Save the workspace before creating a folder link');
      const readDirectory = async () => {
        const current = (await host.readSnapshot(handle)).entries;
        const folder = current.find(
          (entry) => entry.kind === 'directory' && entry.path === normalized,
        );
        if (!folder) throw new Error('The folder no longer exists');
        if (
          folder.folderId &&
          findFoldersById(current, folder.folderId).length !== 1
        )
          throw new Error('The folder identity is ambiguous');
        return folder;
      };
      const existing = await readDirectory();
      if (existing.folderId) return existing.folderId;
      if (!writable())
        throw new Error('A folder link requires a writable workspace');
      const receipt = await host.commit(handle, {
        transactionId: createId(),
        writes: [folderIdentityWrite(normalized, crypto.randomUUID())],
      });
      if (receipt.outcome !== 'applied' && receipt.reason !== 'target-exists')
        throw new Error('Could not save the folder link');
      await syncFromHost();
      const current = await readDirectory();
      if (!current.folderId)
        throw new Error('The folder identity could not be read');
      return current.folderId;
    },
    readRawFile,
    async commitWorkspaceSkills(request) {
      const writable = () =>
        !disposed &&
        !workspaceReadonly &&
        !mutationsPaused &&
        !frozen &&
        !storageRetry;
      if (!writable() || !(await flush()) || !writable())
        throw new Error('Workspace is not ready to save Skills');
      if (
        !request.transactionId ||
        !((request.writes?.length ?? 0) + (request.trash?.length ?? 0))
      )
        throw new Error('Empty Skill transaction');
      for (const write of request.writes ?? []) {
        const definition = workspaceSkillDefinition(write.path);
        if (definition.scope === 'custom' && write.expectedVersion === null)
          customSkillDefinition(definition.name);
        parseWorkspaceSkill(
          write.path,
          typeof write.content === 'string'
            ? write.content
            : new TextDecoder('utf-8', { fatal: true }).decode(write.content),
          null,
        );
      }
      for (const item of request.trash ?? []) {
        workspaceSkillDefinition(item.path);
        if (!item.expectedVersion)
          throw new Error('Skill removal requires its file version');
      }
      const skillRequest: WorkspaceSkillCommit = {
        transactionId: request.transactionId,
        ...(request.writes
          ? {
              writes: request.writes.map(
                ({ path, content, expectedVersion }) => ({
                  path,
                  content,
                  expectedVersion,
                }),
              ),
            }
          : {}),
        ...(request.trash
          ? {
              trash: request.trash.map(({ path, expectedVersion }) => ({
                path,
                expectedVersion,
              })),
            }
          : {}),
      };
      const key = JSON.stringify(skillRequest);
      if (skillRetry && skillRetry.key !== key)
        throw new Error(
          'Confirm the previous Skill transaction before saving another draft',
        );
      skillRetry ??= { key, request: structuredClone(skillRequest) };
      suspendSync++;
      let receipt: CommitReceipt;
      try {
        receipt = await host.commit(handle, skillRetry.request);
      } catch {
        receipt = {
          transactionId: request.transactionId,
          outcome: 'rejected',
          reason: 'io-error',
        };
      } finally {
        suspendSync--;
      }
      if (receipt.reason !== 'io-error') skillRetry = null;
      if (receipt.outcome === 'applied') await syncFromHost();
      drainSync();
      return receipt;
    },
    async commitResources(writes, liveFileIds = []) {
      if (
        workspaceReadonly ||
        mutationsPaused ||
        frozen ||
        storageRetry ||
        !(await flush())
      )
        throw new Error('Workspace is not ready to save resources');
      if (workspaceReadonly || mutationsPaused || frozen || storageRetry)
        throw new Error('Workspace became unavailable');
      if (liveFileIds.some((id) => !files.has(id)))
        throw new Error('Resource source was removed while saving');
      const receipt = await commitFiles({
        transactionId: createId(),
        resourceWrites: writes.map((write) => ({
          ...write,
          path: normalizeResourceKey(write.path),
        })),
      });
      if (receipt.outcome === 'applied') await syncFromHost();
      return receipt;
    },
    async resolveConflict(fileId, action) {
      if (workspaceReadonly || mutationsPaused || frozen || storageRetry)
        return invalid('Workspace is unavailable');
      const entry = files.get(fileId);
      if (!entry) return invalid(`Unknown file: ${fileId}`, fileId);
      if (action === 'save-copy') {
        const closure = workspaceFileClosure(
          [...files.values()].map((item) => item.file),
          fileId,
        );
        const sourceIds = new Set(
          closure.flatMap((file) =>
            file.format === 'verd-document'
              ? [file.id]
              : [file.frame.id, ...Object.keys(file.cells)],
          ),
        );
        const remapped = remapWorkspaceFiles(
          closure,
          (id) => sourceIds.has(id),
          createId,
          undefined,
          registry,
        ).files;
        const taken = new Set(entries.map((item) => item.path));
        const candidate = new Map(
          [...files].map(([id, item]) => [
            id,
            { file: item.file, path: item.path },
          ]),
        );
        const writes: FileWriteOp[] = [];
        for (const file of remapped) {
          const id = workspaceFileId(file);
          if (candidate.has(id))
            return invalid('Recovered copy identity is occupied');
          const path =
            file.format === 'verd-document'
              ? documentPathFor(file, '', taken)
              : canvasPathFor(file, '', taken);
          taken.add(path);
          candidate.set(id, { file, path });
          writes.push({
            path,
            content: JSON.stringify(file, null, 2),
            expectedVersion: null,
          });
        }
        const issues = validateCandidate({ candidate });
        if (issues.length) return { ok: false, diagnostics: issues };
        const copyReceipt = await host.commit(handle, {
          transactionId: createId(),
          writes,
        });
        if (copyReceipt.outcome !== 'applied')
          return invalid('Could not preserve the local copy');
        await syncFromHost();
        action = 'load-disk';
      }
      const capturedWrite = pending.writes.get(entry.path);
      suspendSync += 1;
      const transactionId = `${createId()}-resolve`;
      const persistenceAttempt = filePersistence.begin({ transactionId }, [
        { id: fileId, write: action === 'keep-local' },
      ]);
      emit();
      try {
        const receipt = await host.resolveConflict(handle, {
          path: entry.path,
          action,
          content:
            action === 'keep-local'
              ? JSON.stringify(entry.file, null, 2)
              : undefined,
          transactionId,
        });
        filePersistence.finish(
          persistenceAttempt,
          receipt.outcome === 'applied',
        );
        invalidateSnapshot();
        if (receipt.outcome !== 'applied') {
          markConflict(receipt);
          emit();
          return invalid(
            `Resolution rejected: ${receipt.reason ?? 'unknown'}`,
            fileId,
          );
        }
        if (action === 'keep-local') {
          const version = receipt.versions?.[entry.path];
          const live = files.get(fileId) ?? entry;
          if (capturedWrite && pending.writes.get(entry.path) === capturedWrite)
            pending.writes.delete(entry.path);
          const newerWrite = pending.writes.get(live.path);
          if (newerWrite && version)
            pending.writes.set(live.path, {
              ...newerWrite,
              expectedVersion: version,
            });
          files.set(fileId, {
            ...live,
            version: version ?? entry.version,
            dirty: false,
            conflicted: undefined,
            diagnostic: undefined,
          });
          clearLoadFailure(entry.path);
          (receipt.trashEntries ?? []).forEach(({ path, entryId }) => {
            if (!trash.some((item) => item.entryId === entryId))
              trash.push({
                entryId,
                originalPath: path,
                trashedAt: Date.now(),
              });
          });
          refreshDirty();
          if (
            !hasPending() &&
            ![...files.values()].some((file) => file.conflicted)
          )
            setStatus('saved');
          emit();
          return { ok: true, diagnostics: [] };
        }
        const raw = await host.readFile(handle, entry.path);
        const parsed: unknown = JSON.parse(
          new TextDecoder().decode(raw.content),
        );
        const diskFile: WorkspaceFile = isDocumentPath(entry.path)
          ? (() => {
              if (!isDocumentFileV1(parsed))
                throw new Error('Disk file is not a v1 document file');
              return parsed;
            })()
          : (() => {
              if (!isFrameFileV2(parsed))
                throw new Error('Disk file is not a v2 frame file');
              return parsed;
            })();
        if (workspaceFileId(diskFile) !== fileId)
          throw new Error('Disk file holds a different file identity');
        const candidate = new Map(
          [...files].map(([id, item]) => [
            id,
            { file: item.file, path: item.path },
          ]),
        );
        candidate.set(fileId, { file: diskFile, path: entry.path });
        const issues = validateCandidate({ candidate });
        if (issues.length)
          throw new Error(issues.map((issue) => issue.message).join('; '));
        // Disk reads also await I/O: retain any edits made during resolution
        // or the read itself before replacing the local file.
        if (
          files.get(fileId)?.file !== entry.file ||
          files.get(fileId)?.path !== entry.path
        ) {
          emit();
          return invalid(
            'Local edits changed while resolving the conflict; they were retained',
            fileId,
          );
        }
        // Recorded like a command: undoing restores the discarded local edit.
        undoStack.push({
          label: 'load-disk',
          primaryFileId: fileId,
          before: new Map([
            [fileId, { file: clone(entry.file), path: entry.path }],
          ]),
          after: new Map([
            [fileId, { file: clone(diskFile), path: entry.path }],
          ]),
        });
        redoStack.length = 0;
        if (capturedWrite && pending.writes.get(entry.path) === capturedWrite)
          pending.writes.delete(entry.path);
        files.set(fileId, {
          file: diskFile,
          path: entry.path,
          version: raw.version,
          dirty: false,
        });
        filePersistence.adoptDisk(fileId);
        clearLoadFailure(entry.path);
        rebuildDerived();
        refreshDirty();
        if (
          !hasPending() &&
          ![...files.values()].some((file) => file.conflicted)
        )
          setStatus('saved');
        emit();
        return {
          ok: true,
          diagnostics: [],
          restored: { fileId },
        };
      } catch (error) {
        filePersistence.finish(persistenceAttempt, false);
        const message = error instanceof Error ? error.message : String(error);
        diagnostics = [
          ...diagnostics,
          {
            frameId: fileId,
            path: entry.path,
            message: `Resolve failed: ${message}`,
          },
        ];
        emit();
        return invalid(`Resolve failed: ${message}`, fileId);
      } finally {
        suspendSync -= 1;
        drainSync();
      }
    },
    exportFiles(frameId) {
      const byId = new Map<CellId, FrameFileV2>();
      files.forEach((entry, id) => {
        if (entry.file.format === 'verd-frame') byId.set(id, entry.file);
      });
      return frameClosure([...byId.values()], frameId).map((id) =>
        clone(byId.get(id)!),
      );
    },
    exportWorkspaceFiles(fileId) {
      return workspaceFileClosure(
        [...files.values()].map((entry) => entry.file),
        fileId,
      ).map((file) => clone(file));
    },
    exportDocument(fileId) {
      const entry = files.get(fileId);
      return entry?.file.format === 'verd-document' ? clone(entry.file) : null;
    },
    async flush() {
      // Closing or switching a workspace must wait for explicit Git operations,
      // including publication of a restore or rewritten object database.
      if (gitOperation) {
        try {
          await gitOperation;
        } catch {
          return false;
        }
      }
      return flush();
    },
    freeze() {
      frozen = true;
    },
    unfreeze() {
      frozen = false;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribeHost();
      listeners.clear();
    },
  };
};

/**
 * Loads a host snapshot into a session. Invalid canvases stay out of the file
 * index but their diagnostics survive; duplicate root identities are reported
 * rather than silently picking one.
 */
export const openWorkspaceSession = async (
  host: WorkspaceHost,
  handle: WorkspaceHandle,
  options: WorkspaceSessionOptions = {},
): Promise<WorkspaceSession> => {
  const snapshot = await host.readSnapshot(handle);
  const registry = options.registry ?? createWorkspaceCellRegistry();
  const loaded = await readWorkspaceFiles(host, handle, snapshot, registry);
  return createWorkspaceSession({
    host,
    handle,
    registry,
    delayMs: options.delayMs,
    createId: options.createId,
    onStatus: options.onStatus,
    onCommitted: options.onCommitted,
    files: loaded.files,
    failedFiles: loaded.failedFiles,
    context: snapshot.context,
    agent: snapshot.agent,
    config: snapshot.config,
    // Legacy `{frameId}` tabs and v2 `{fileId}` tabs converge here.
    session: normalizeWorkspaceSessionState(snapshot.session),
    trash: snapshot.trash,
    entries: snapshot.entries,
    resources: snapshot.resources,
    diagnostics: loaded.diagnostics,
  });
};

/** Helpers for callers that map between canvas paths and identities. */
export const canvasFrameIdAt = (
  snapshot: WorkspaceSessionSnapshot,
  path: string,
) => snapshot.fileIdByPath.get(path);

export const isCanvasEntry = (path: string) => isCanvasPath(path);

export const canvasParentDir = (path: string) =>
  parentWorkspacePath(path) ?? '';

export const canvasDisplayName = (path: string) =>
  baseName(path).replace(/\.verd(?:\.json)?$/, '');

export const isDocumentEntry = (path: string) => isDocumentPath(path);

export { documentDisplayName } from '../documents/document-files';
